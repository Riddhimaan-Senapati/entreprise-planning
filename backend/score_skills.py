"""
Skill Match Scorer
------------------
Parses coverageiq/lib/mock-data.ts, scores each task-member suggestion pair
using Google Gemini 2.5 Flash (via pydantic-ai), and writes results to
backend/skill_scores.json.

Inputs fed to Gemini per pair:
  - Task title, priority, status
  - Member name, role, skills
  - Context reason (why they were suggested)

Output JSON format:
  {
    "task-001": {
      "mem-007": { "skill_match_pct": 91, "reasoning": "..." },
      ...
    },
    ...
  }

Usage:
    python score_skills.py           # score all pairs
    python score_skills.py --dry-run # parse only, no API calls
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError

# ── Env setup (must happen before Agent is created) ────────────────────────────
load_dotenv()
if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

if not os.getenv("GOOGLE_API_KEY"):
    print("ERROR: GEMINI_API_KEY is not set in your .env file.")
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
MOCK_DATA_PATH = REPO_ROOT / "coverageiq" / "lib" / "mock-data.ts"
OUTPUT_PATH = Path(__file__).parent / "skill_scores.json"

# ── Config ─────────────────────────────────────────────────────────────────────
GEMINI_MODEL = "google-gla:gemini-2.5-flash"
INTER_CALL_DELAY = 4   # seconds between calls — free tier is 15 RPM
MAX_RETRIES = 4

# ── Output model ───────────────────────────────────────────────────────────────
class SkillScore(BaseModel):
    skill_match_pct: int = Field(ge=0, le=100,
        description="Skill match percentage between the candidate and the task (0–100).")
    reasoning: str = Field(
        description="One-line explanation of what drove the score.")


# ── Agent ──────────────────────────────────────────────────────────────────────
agent = Agent(
    GEMINI_MODEL,
    output_type=SkillScore,
    system_prompt=(
        "You are a technical talent-matching system. "
        "Given a task description and a team member's profile, score how well "
        "the member's skills match the task requirements on a scale of 0–100. "
        "Factors to consider:\n"
        "  • Direct skill overlap with the task domain (most important)\n"
        "  • Seniority and role relevance\n"
        "  • Any prior context mentioned about why they were suggested\n"
        "Be precise, consistent, and critical — don't inflate scores. "
        "Return an integer score and a single concise sentence explaining it."
    ),
)

# ── TypeScript parser ──────────────────────────────────────────────────────────

def _str_field(text: str, field: str) -> Optional[str]:
    """Extract a string field value — handles both single and double quotes."""
    match = re.search(rf"{re.escape(field)}:\s*(?:'([^']*)'|\"([^\"]*)\")", text)
    if not match:
        return None
    return match.group(1) if match.group(1) is not None else match.group(2)


def _list_field(text: str, field: str) -> list[str]:
    """Extract a string array field, e.g. skills: ['a', 'b']."""
    match = re.search(rf"{re.escape(field)}:\s*\[([^\]]+)\]", text)
    if not match:
        return []
    return re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))


def _split_objects(block: str) -> list[str]:
    """Split a flat JS/TS array body into top-level { } object strings."""
    objects = []
    depth = 0
    start = None
    for i, ch in enumerate(block):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(block[start : i + 1])
                start = None
    return objects


def parse_mock_data(path: Path) -> tuple[list[dict], dict[str, dict]]:
    """
    Parse atRiskTasks and teamMembers from a mock-data.ts file.

    Returns:
        tasks:   list of task dicts, each with id/title/priority/status/suggestions
        members: dict keyed by member id → {id, name, role, skills}
    """
    source = path.read_text(encoding="utf-8")

    # ── Tasks ──────────────────────────────────────────────────────────────────
    tasks_match = re.search(
        r"export const atRiskTasks[^=]*=\s*\[(.+?)\];\s*\n",
        source, re.DOTALL,
    )
    if not tasks_match:
        raise ValueError("Could not locate atRiskTasks array in mock-data.ts")

    tasks: list[dict] = []
    for task_block in _split_objects(tasks_match.group(1)):
        task_id = _str_field(task_block, "id")
        if not task_id:
            continue

        # Parse nested suggestions array
        sugg_match = re.search(r"suggestions:\s*\[(.+?)\]", task_block, re.DOTALL)
        suggestions = []
        if sugg_match:
            for s in _split_objects(sugg_match.group(1)):
                mid = _str_field(s, "memberId")
                reason = _str_field(s, "contextReason")
                if mid:
                    suggestions.append({"memberId": mid, "contextReason": reason or ""})

        tasks.append({
            "id": task_id,
            "title": _str_field(task_block, "title") or "",
            "priority": _str_field(task_block, "priority") or "",
            "status": _str_field(task_block, "status") or "",
            "suggestions": suggestions,
        })

    # ── Members ────────────────────────────────────────────────────────────────
    members_match = re.search(
        r"export const teamMembers[^=]*=\s*\[(.+)\];\s*\n",
        source, re.DOTALL,
    )
    if not members_match:
        raise ValueError("Could not locate teamMembers array in mock-data.ts")

    members: dict[str, dict] = {}
    for mem_block in _split_objects(members_match.group(1)):
        mid = _str_field(mem_block, "id")
        if mid and mid.startswith("mem-"):
            members[mid] = {
                "id": mid,
                "name": _str_field(mem_block, "name") or mid,
                "role": _str_field(mem_block, "role") or "",
                "skills": _list_field(mem_block, "skills"),
            }

    return tasks, members


# ── Retry helper ───────────────────────────────────────────────────────────────

def _retry_delay(exc: ModelHTTPError) -> int:
    """Extract suggested retry-after seconds from a Gemini 429 body."""
    try:
        for d in exc.body.get("error", {}).get("details", []):
            if "RetryInfo" in d.get("@type", ""):
                return int(d.get("retryDelay", "60s").rstrip("s")) + 5
    except Exception:
        pass
    return 65


# ── Scoring ────────────────────────────────────────────────────────────────────

def score_pair(task: dict, member: dict, context_reason: str) -> SkillScore:
    """Send one task-member pair to Gemini and return the structured score."""
    prompt = (
        f"Task title    : {task['title']}\n"
        f"Task priority : {task['priority']}\n"
        f"Task status   : {task['status']}\n\n"
        f"Candidate     : {member['name']} ({member['role']})\n"
        f"Skills        : {', '.join(member['skills']) or 'none listed'}\n\n"
        f"Why suggested : {context_reason}\n\n"
        "Score how well this candidate's skills match the task (0–100)."
    )
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return agent.run_sync(prompt).output
        except ModelHTTPError as e:
            if e.status_code == 429 and attempt < MAX_RETRIES:
                wait = _retry_delay(e)
                print(f"    [rate-limited] waiting {wait}s before retry {attempt}...")
                time.sleep(wait)
            else:
                raise


# ── Main ───────────────────────────────────────────────────────────────────────

def main(dry_run: bool) -> None:
    if not MOCK_DATA_PATH.exists():
        print(f"ERROR: Cannot find {MOCK_DATA_PATH}")
        print("  Make sure you are running from the backend/ directory.")
        sys.exit(1)

    print("Skill Match Scorer")
    print("=" * 60)
    print(f"Source  : {MOCK_DATA_PATH.relative_to(REPO_ROOT)}")
    print(f"Output  : {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    print(f"Model   : {GEMINI_MODEL}")
    if dry_run:
        print("Mode    : DRY RUN (no API calls)")

    tasks, members = parse_mock_data(MOCK_DATA_PATH)
    total_pairs = sum(len(t["suggestions"]) for t in tasks)
    print(f"\nParsed  : {len(tasks)} tasks · {len(members)} members · {total_pairs} pairs\n")

    if dry_run:
        for task in tasks:
            print(f"  {task['id']}  {task['priority']}  {task['title']}")
            for s in task["suggestions"]:
                m = members.get(s["memberId"], {})
                print(f"      {s['memberId']}  {m.get('name', '?')}  [{', '.join(m.get('skills', []))}]")
        return

    # Load existing scores so the script can be safely interrupted and resumed
    scores: dict = {}
    if OUTPUT_PATH.exists():
        scores = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        already = sum(len(v) for v in scores.values())
        print(f"Resuming — {already} pair(s) already scored.\n")

    done = 0
    skipped = 0
    for task in tasks:
        task_id = task["id"]
        scores.setdefault(task_id, {})

        for sugg in task["suggestions"]:
            member_id = sugg["memberId"]

            if member_id in scores[task_id]:
                skipped += 1
                continue

            member = members.get(member_id)
            if not member:
                print(f"  WARNING: {member_id} not found in teamMembers — skipping")
                continue

            print(f"  [{task_id} / {member_id}]  {member['name']}")
            result = score_pair(task, member, sugg["contextReason"])

            scores[task_id][member_id] = {
                "skillMatchPct": result.skill_match_pct,
                "contextReason": result.reasoning,
            }
            done += 1
            print(f"    score  : {result.skill_match_pct}%")
            print(f"    reason : {result.reasoning}")

            # Write after every pair so progress is never lost
            OUTPUT_PATH.write_text(
                json.dumps(scores, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            remaining = total_pairs - done - skipped
            if remaining > 0:
                time.sleep(INTER_CALL_DELAY)

    print(f"\n{'=' * 60}")
    print(f"Done.  Scored: {done}  Skipped (already done): {skipped}")
    print(f"Results → {OUTPUT_PATH}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Score skill matches using Gemini.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse mock-data.ts and print pairs without calling the API.",
    )
    args = parser.parse_args()
    main(dry_run=args.dry_run)

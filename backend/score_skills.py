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
import sys
import time
from pathlib import Path

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError

from data_loader import MOCK_DATA_PATH, REPO_ROOT, parse_mock_data

# ── Env setup (must happen before Agent is created) ────────────────────────────
load_dotenv()
if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

if not os.getenv("GOOGLE_API_KEY"):
    print("ERROR: GEMINI_API_KEY is not set in your .env file.")
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────────
# MOCK_DATA_PATH imported from data_loader
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

"""
skill_pipeline.py
-----------------
DB-aware skill scoring pipeline.

Scores a given task against all eligible team members using Gemini AI,
then persists the ranked suggestions to the suggestions table.

Called from routers/tasks.py as a FastAPI BackgroundTask after:
  - Task creation (always runs to pre-populate suggestions)
  - Task unassignment (re-runs to refresh candidates)
"""

import os
import time

from dotenv import load_dotenv
from sqlmodel import Session, select

load_dotenv()
if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

from database import engine  # noqa: E402 – after env setup
from models import Suggestion, Task, TeamMember  # noqa: E402

# ── Gemini setup (optional — falls back to heuristic scores if unavailable) ────

_GEMINI_AVAILABLE = bool(os.getenv("GOOGLE_API_KEY"))

if _GEMINI_AVAILABLE:
    from pydantic import BaseModel as _PModel, Field as _PField
    from pydantic_ai import Agent as _Agent
    from pydantic_ai.exceptions import ModelHTTPError as _ModelHTTPError

    class _SkillScore(_PModel):
        skill_match_pct: int = _PField(ge=0, le=100)
        reasoning: str

    _agent = _Agent(
        "google-gla:gemini-2.5-flash",
        output_type=_SkillScore,
        system_prompt=(
            "You are a technical talent-matching system. "
            "Given a task description and a team member's profile, score how well "
            "the member's skills match the task requirements on a scale of 0–100. "
            "Factors: direct skill overlap (most important), seniority, role relevance, "
            "and any manager notes that indicate the person's strengths or limitations. "
            "Be precise and critical — don't inflate scores. "
            "Return an integer score and a single concise sentence explaining it."
        ),
    )

INTER_CALL_DELAY = 4   # seconds between Gemini calls (free tier: 15 RPM)
MAX_RETRIES = 3
MAX_CANDIDATES = 6     # top members to score per pipeline run


# ── Helpers ────────────────────────────────────────────────────────────────────

def _simple_relevance(task_title: str, project: str, skills: list[str], role: str) -> int:
    """Word-overlap heuristic used to pre-filter candidates before calling Gemini."""
    haystack = (role + " " + " ".join(skills)).lower()
    needles = (task_title + " " + project).lower().split()
    return sum(1 for n in needles if len(n) > 3 and n in haystack)


def _workload_pct(task_load_hours: float) -> float:
    return min(100.0, round(task_load_hours / 40 * 100, 1))


def _retry_delay(exc) -> int:
    try:
        for d in exc.body.get("error", {}).get("details", []):
            if "RetryInfo" in d.get("@type", ""):
                return int(d.get("retryDelay", "60s").rstrip("s")) + 5
    except Exception:
        pass
    return 65


def _score_with_gemini(task: Task, member: TeamMember) -> tuple[int, str]:
    """Call Gemini to score one pair. Returns (skill_match_pct, context_reason)."""
    if not _GEMINI_AVAILABLE:
        heuristic = _simple_relevance(
            task.title, task.project_name, member.skills or [], member.role
        )
        pct = min(90, 40 + heuristic * 10)
        return pct, "Gemini not configured — score estimated from skill keyword overlap."

    notes_line = (
        f"\nManager notes : {member.manager_notes}"
        if member.manager_notes else ""
    )

    prompt = (
        f"Task title    : {task.title}\n"
        f"Task priority : {task.priority}\n"
        f"Project       : {task.project_name}\n\n"
        f"Candidate     : {member.name} ({member.role})\n"
        f"Skills        : {', '.join(member.skills or []) or 'none listed'}\n"
        f"Availability  : {member.leave_status} · calendar {member.calendar_pct}%"
        f" · {member.task_load_hours}h task load{notes_line}\n\n"
        "Score how well this candidate's skills match the task (0–100)."
    )

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            result = _agent.run_sync(prompt).output
            return result.skill_match_pct, result.reasoning
        except _ModelHTTPError as e:
            if e.status_code == 429 and attempt < MAX_RETRIES:
                wait = _retry_delay(e)
                print(f"[skill_pipeline] rate-limited, waiting {wait}s (attempt {attempt})…")
                time.sleep(wait)
            else:
                raise

    return 50, "Scoring failed after retries — default score applied."


# ── Public entry point ─────────────────────────────────────────────────────────

def run_pipeline_for_task(task_id: str) -> None:
    """
    Score all eligible members against the given task and persist suggestions.
    Creates its own DB session — safe to call from a background thread.
    """
    print(f"[skill_pipeline] Starting pipeline for task {task_id} …")

    with Session(engine) as db:
        task = db.get(Task, task_id)
        if not task:
            print(f"[skill_pipeline] Task {task_id} not found — aborting.")
            return

        all_members = db.exec(select(TeamMember)).all()

        # Exclude current assignee and OOO members
        candidates = [
            m for m in all_members
            if m.id != task.assignee_id and m.leave_status != "ooo"
        ]

        # Pre-rank by keyword heuristic, keep top MAX_CANDIDATES
        candidates.sort(
            key=lambda m: _simple_relevance(
                task.title, task.project_name, m.skills or [], m.role
            ),
            reverse=True,
        )
        candidates = candidates[:MAX_CANDIDATES]

        print(f"[skill_pipeline] Scoring {len(candidates)} candidates…")

        # Delete existing suggestions for this task
        for s in db.exec(select(Suggestion).where(Suggestion.task_id == task_id)).all():
            db.delete(s)
        db.commit()

        # Score each candidate
        scored: list[tuple[int, TeamMember, float, str]] = []
        for i, member in enumerate(candidates):
            try:
                pct, reason = _score_with_gemini(task, member)
            except Exception as exc:
                print(f"[skill_pipeline] Error scoring {member.id}: {exc}")
                pct, reason = 50, "Scoring error — default score applied."

            workload = _workload_pct(member.task_load_hours)
            scored.append((pct, member, workload, reason))
            print(f"[skill_pipeline]   {member.name}: {pct}%")

            if i < len(candidates) - 1 and _GEMINI_AVAILABLE:
                time.sleep(INTER_CALL_DELAY)

        # Sort by skill_match_pct descending, assign rank
        scored.sort(key=lambda x: x[0], reverse=True)
        for rank, (pct, member, workload, reason) in enumerate(scored):
            db.add(Suggestion(
                task_id=task_id,
                member_id=member.id,
                skill_match_pct=float(pct),
                workload_pct=workload,
                context_reason=reason,
                rank=rank,
            ))

        db.commit()
        print(f"[skill_pipeline] Done — {len(scored)} suggestions saved for {task_id}.")

"""
seed.py
-------
Populates the SQLite database from the canonical JSON files in backend/data/:
  data/members.json  — 24 team members + per-day week availability
  data/tasks.json    — 6 at-risk tasks with ranked suggestions

Run once:
    python seed.py

Safe to run multiple times: skips seeding if team_members table is not empty.

After seeding, Maya Patel's calendar_pct is automatically computed from
dummy_maya_calendar.ics so one member has a live ICS-derived availability.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlmodel import Session, select

from database import create_db_and_tables, engine
from models import Suggestion, Task, TeamMember, WeekAvailability

NOW = datetime.now(timezone.utc)
THREE_HOURS_AGO = NOW - timedelta(hours=3)

_DATA_DIR = Path(__file__).parent / "data"


def _load_members() -> list[dict]:
    return json.loads((_DATA_DIR / "members.json").read_text(encoding="utf-8"))


def _load_tasks() -> list[dict]:
    return json.loads((_DATA_DIR / "tasks.json").read_text(encoding="utf-8"))


# ── Seeding logic ──────────────────────────────────────────────────────────────

def seed(db: Session) -> None:
    # Guard: skip if already seeded
    existing = db.exec(select(TeamMember)).first()
    if existing:
        print("Database already seeded — skipping.")
        return

    members = _load_members()
    tasks = _load_tasks()

    print("Seeding team members...")
    for m in members:
        week = m.pop("week")
        ics_path = m.pop("ics_path", None)
        member = TeamMember(
            **m,
            ics_path=ics_path,
            last_synced=THREE_HOURS_AGO,
        )
        db.add(member)
        db.add(WeekAvailability(
            member_id=m["id"],
            monday=week["monday"],
            tuesday=week["tuesday"],
            wednesday=week["wednesday"],
            thursday=week["thursday"],
            friday=week["friday"],
        ))

    print("Seeding tasks and suggestions...")
    for t in tasks:
        suggestions = t.pop("suggestions")
        deadline_hours = t.pop("deadline_hours")
        db.add(Task(**t, deadline=NOW + timedelta(hours=deadline_hours)))
        for rank, s in enumerate(suggestions):
            db.add(Suggestion(
                task_id=t["id"],
                member_id=s["member_id"],
                skill_match_pct=s["skill_match_pct"],
                workload_pct=s["workload_pct"],
                context_reason=s["context_reason"],
                rank=rank,
            ))

    db.commit()
    print(f"Seeded {len(members)} members and {len(tasks)} tasks.")

    # Run ICS availability for Maya Patel so she has a live calendar_pct
    _sync_maya(db)


def _sync_maya(db: Session) -> None:
    """After seeding, compute Maya Patel's real per-day availability from her ICS file."""
    from calendar_availability import get_availability_report
    from crud import update_member_calendar_pct, update_member_week_availability
    from datetime import date

    ics_path = Path(__file__).parent / "dummy_maya_calendar.ics"
    if not ics_path.exists():
        print("Warning: dummy_maya_calendar.ics not found — skipping ICS sync for Maya.")
        return

    today = date.today()
    report = get_availability_report(
        ics_path=ics_path,
        range_start=today,
        range_end=today + timedelta(weeks=1),
    )

    day_map = {
        "Monday": "monday", "Tuesday": "tuesday", "Wednesday": "wednesday",
        "Thursday": "thursday", "Friday": "friday",
    }
    per_day = {day_map[d["weekday"]]: round(d["availability_pct"])
               for d in report["per_day"] if d["weekday"] in day_map}

    updated = update_member_calendar_pct(db, "mem-012", report["availability_pct"])
    update_member_week_availability(db, "mem-012", per_day)

    print(
        f"Maya Patel calendar synced: {report['availability_pct']}% available "
        f"({report['total_available_minutes']}/{report['total_work_minutes']} min) "
        f"→ confidence_score={updated.confidence_score} | per-day={per_day}"
    )


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    create_db_and_tables()
    with Session(engine) as db:
        seed(db)
    print("Done.")

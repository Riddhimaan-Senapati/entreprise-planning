"""
generate_team_ics.py
====================
Generates realistic synthetic ICS calendar files for every team member who
doesn't already have a real ICS file, then runs the same
`calendar_availability.calculate_availability` pipeline used for Maya to
persist per-day scores, calendar_pct, and confidence_score back into the DB.

Each member is assigned one of five workload profiles (deterministically from
their member ID seed) so that computed calendar_pct values spread meaningfully
across the team:

  heavy_meetings  — back-to-back syncs, many reviews, almost no focus time
  deep_focus      — all standard meetings plus many focus blocks (OPAQUE)
  balanced        — moderate meetings and focus blocks (default)
  light           — only standup + 1:1, very few optional events
  frequent_ooo    — standard recurring plus 4–6 all-day OOO blocks

Standard recurring events (present in most profiles):
  - Daily standup (30 min, Mon–Fri)
  - Weekly team sync (1 h, Monday) — skipped by "light"
  - 1:1 with manager (30 min, Wednesday)
  - Bi-weekly sprint ceremony (2 h, Wednesday) — skipped by "light"
  - Monthly all-hands (1.5 h, Friday) — skipped by "light"

Profile-specific extras:
  - heavy_meetings: +3 recurring 1-hour syncs (Mon/Tue/Thu afternoons)
  - deep_focus: 5–8 focus blocks per week (1.5–2.5 h each)
  - balanced: 2–4 focus blocks/week, 1–3 reviews, 0–2 OOO days
  - light: 0–1 focus blocks, 0–1 reviews, no OOO
  - frequent_ooo: 4–6 all-day OOO blocks across the next 12 weeks

Events are deterministically seeded by the member's ID so results are
reproducible; re-running the script produces identical ICS files.

After generating the ICS:
  1. Saves the file to backend/ics/<member_id>.ics
  2. Updates member.ics_path in the DB (so /calendar/sync works later)
  3. Runs calendar_availability.get_availability_report on the file
  4. Persists calendar_pct, per-day availability, and confidence_score

Usage:
    cd backend
    python generate_team_ics.py

Skip members listed in REAL_ICS_MEMBERS (they already have real calendars).
"""

from __future__ import annotations

import random
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from sqlmodel import Session, select

from calendar_availability import get_availability_report
from crud import update_member_calendar_pct, update_member_week_availability
from database import create_db_and_tables, engine
from models import TeamMember

# ── Config ─────────────────────────────────────────────────────────────────────

ICS_DIR = Path(__file__).parent / "ics"
BACKEND_DIR = Path(__file__).parent

# Members that already have a real ICS — skip generation
REAL_ICS_MEMBERS: set[str] = {"mem-012"}  # Maya Patel

# How many weeks of recurring events to generate
RECURRING_COUNT = 12

# ── Date helpers ───────────────────────────────────────────────────────────────

def _next_monday() -> date:
    today = date.today()
    days_ahead = (7 - today.weekday()) % 7
    return today + timedelta(days=days_ahead or 7)


def _fmt_dt(d: date, hour: int, minute: int = 0) -> str:
    return f"{d.strftime('%Y%m%d')}T{hour:02d}{minute:02d}00Z"


def _fmt_date(d: date) -> str:
    return d.strftime("%Y%m%d")


# ── ICS block builders ─────────────────────────────────────────────────────────

def _vevent(summary: str, dtstart: str, dtend: str, rrule: str | None = None,
            uid: str | None = None, description: str = "") -> str:
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid or str(uuid.uuid4())}",
        f"SUMMARY:{summary}",
        f"DTSTART:{dtstart}",
        f"DTEND:{dtend}",
    ]
    if rrule:
        lines.append(f"RRULE:{rrule}")
    if description:
        lines.append(f"DESCRIPTION:{description}")
    lines += ["STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT"]
    return "\r\n".join(lines) + "\r\n"


def _allday_vevent(summary: str, d: date, uid: str | None = None) -> str:
    end = d + timedelta(days=1)
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid or str(uuid.uuid4())}",
        f"SUMMARY:{summary}",
        f"DTSTART;VALUE=DATE:{_fmt_date(d)}",
        f"DTEND;VALUE=DATE:{_fmt_date(end)}",
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
    ]
    return "\r\n".join(lines) + "\r\n"


# ── Event catalogue ─────────────────────────────────────────────────────────────

FOCUS_BLOCK_NAMES = [
    "Focus Block — Deep Work",
    "Focus Block — Code Review",
    "Focus Block — Documentation",
    "Focus Block — Design Review",
    "Focus Block — Research",
    "Focus Block — Architecture Work",
]

REVIEW_MEETING_NAMES = [
    "Product Review",
    "Cross-Team Sync",
    "Architecture Review",
    "Design Critique",
    "Retrospective",
    "Stakeholder Update",
    "Quarterly Planning",
]

OOO_LABELS = [
    "Out of Office — Conference",
    "Out of Office — Personal",
    "Out of Office — Training",
    "Out of Office — Travel",
]

# Focus block lengths in (start_hour, duration_hours)
FOCUS_SLOTS = [
    (9, 1.5),
    (9, 2.0),
    (9, 2.5),
    (10, 1.5),
    (10, 2.0),
    (13, 1.5),
    (14, 1.5),
    (14, 2.0),
]

# Review meeting slots (start_hour, duration_hours)
REVIEW_SLOTS = [
    (11, 1.0),
    (13, 1.0),
    (14, 1.0),
    (15, 1.0),
    (15, 0.5),
    (16, 1.0),
]

# ── Workload profiles ───────────────────────────────────────────────────────────
#
# Each profile controls which recurring events are included and how many
# focus blocks, reviews, and OOO days are generated.  Profiles are assigned
# deterministically by (seed % len(PROFILES)) so every member always gets the
# same profile across runs.
#
#   focus_pw      — (min, max) focus blocks attempted per week, over 4 weeks
#   review_total  — (min, max) total review meetings over the 4-week window
#   ooo_count     — (min, max) all-day OOO blocks over the next 12 weeks
#   extra_syncs   — list of (day_abbr, start_hour, title) for extra recurring
#                   1-hour syncs added on top of the standard recurring set

PROFILES = ["heavy_meetings", "deep_focus", "balanced", "light", "frequent_ooo"]

PROFILE_PARAMS: dict[str, dict] = {
    # Executive / manager archetype: wall-to-wall syncs, almost no focus time.
    # Expected calendar_pct: ~30–50%
    "heavy_meetings": dict(
        extra_syncs=[
            ("MO", 15, "Leadership Sync"),
            ("TU", 11, "Cross-Team Alignment"),
            ("TH", 11, "Status Review"),
        ],
        include_team_sync=True,
        include_sprint=True,
        include_allhands=True,
        focus_pw=(0, 0),
        review_total=(5, 8),
        ooo_count=(0, 0),
    ),

    # IC who blocks calendar with focus time: large OPAQUE footprint.
    # Expected calendar_pct: ~42–58%
    "deep_focus": dict(
        extra_syncs=[],
        include_team_sync=True,
        include_sprint=True,
        include_allhands=True,
        focus_pw=(5, 8),
        review_total=(0, 1),
        ooo_count=(0, 0),
    ),

    # Standard IC: moderate mix of meetings and focus blocks.
    # Expected calendar_pct: ~55–68%
    "balanced": dict(
        extra_syncs=[],
        include_team_sync=True,
        include_sprint=True,
        include_allhands=True,
        focus_pw=(2, 4),
        review_total=(1, 3),
        ooo_count=(0, 2),
    ),

    # Part-time / senior advisor: only mandatory standup + 1:1, calendar mostly free.
    # Expected calendar_pct: ~78–92%
    "light": dict(
        extra_syncs=[],
        include_team_sync=False,
        include_sprint=False,
        include_allhands=False,
        focus_pw=(0, 1),
        review_total=(0, 1),
        ooo_count=(0, 0),
    ),

    # Consultant / traveler: standard meetings plus 4–6 OOO days.
    # Expected calendar_pct: ~38–55%
    "frequent_ooo": dict(
        extra_syncs=[],
        include_team_sync=True,
        include_sprint=True,
        include_allhands=True,
        focus_pw=(1, 2),
        review_total=(1, 3),
        ooo_count=(4, 6),
    ),
}

# Map day abbreviation → weekday offset from Monday
_DAY_OFFSET = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4}


def _assign_profile(seed: int) -> str:
    return PROFILES[seed % len(PROFILES)]


# ── ICS generator ──────────────────────────────────────────────────────────────

def _generate_ics(member: TeamMember, rng: random.Random, profile: str) -> bytes:
    p = PROFILE_PARAMS[profile]
    monday = _next_monday()
    events: list[str] = []
    name = member.name

    # 1. Daily standup — everyone, Mon–Fri
    events.append(_vevent(
        summary="Daily Standup",
        dtstart=_fmt_dt(monday, 9, 0),
        dtend=_fmt_dt(monday, 9, 30),
        rrule=f"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT={RECURRING_COUNT * 5}",
        description="Team standup — blockers and updates",
    ))

    # 2. Weekly team sync — Monday 10:00 (1 h)
    if p["include_team_sync"]:
        events.append(_vevent(
            summary="Weekly Team Sync",
            dtstart=_fmt_dt(monday, 10, 0),
            dtend=_fmt_dt(monday, 11, 0),
            rrule=f"FREQ=WEEKLY;BYDAY=MO;COUNT={RECURRING_COUNT}",
            description="Weekly alignment — roadmap, blockers, demos",
        ))

    # 3. 1:1 with manager — Wednesday 14:00 (30 min)
    wednesday = monday + timedelta(days=2)
    events.append(_vevent(
        summary="1:1 with Manager",
        dtstart=_fmt_dt(wednesday, 14, 0),
        dtend=_fmt_dt(wednesday, 14, 30),
        rrule=f"FREQ=WEEKLY;BYDAY=WE;COUNT={RECURRING_COUNT}",
        description="Weekly check-in: goals, blockers, career dev",
    ))

    # 4. Bi-weekly sprint ceremony — Wednesday 11:00 (2 h)
    if p["include_sprint"]:
        events.append(_vevent(
            summary="Sprint Ceremony",
            dtstart=_fmt_dt(wednesday, 11, 0),
            dtend=_fmt_dt(wednesday, 13, 0),
            rrule=f"FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT={RECURRING_COUNT // 2}",
            description="Sprint planning or retrospective",
        ))

    # 5. Monthly all-hands — Friday 16:00 (1.5 h)
    friday = monday + timedelta(days=4)
    if p["include_allhands"]:
        events.append(_vevent(
            summary="Company All-Hands",
            dtstart=_fmt_dt(friday, 16, 0),
            dtend=_fmt_dt(friday, 17, 30),
            rrule=f"FREQ=WEEKLY;INTERVAL=4;BYDAY=FR;COUNT={RECURRING_COUNT // 4 or 1}",
            description="Monthly company-wide all-hands",
        ))

    # 5b. Extra recurring syncs — heavy_meetings profile
    for day_abbr, start_h, sync_title in p.get("extra_syncs", []):
        day_offset = _DAY_OFFSET[day_abbr]
        sync_day = monday + timedelta(days=day_offset)
        events.append(_vevent(
            summary=sync_title,
            dtstart=_fmt_dt(sync_day, start_h, 0),
            dtend=_fmt_dt(sync_day, start_h + 1, 0),
            rrule=f"FREQ=WEEKLY;BYDAY={day_abbr};COUNT={RECURRING_COUNT}",
        ))

    # 6. Focus blocks — profile-controlled blocks per week over 4 weeks
    focus_min, focus_max = p["focus_pw"]
    used_slots: set[tuple[int, int]] = set()
    if focus_max > 0:
        num_focus = rng.randint(focus_min, focus_max)
        for _ in range(num_focus * 4):  # one attempt per week for 4 weeks
            week_offset = rng.randint(0, 3)
            day_offset = rng.randint(1, 4)  # Tue–Fri (Mon already heavy)
            slot = rng.choice(FOCUS_SLOTS)
            start_h, dur_h = slot
            key = (week_offset * 5 + day_offset, start_h)
            if key in used_slots:
                continue
            used_slots.add(key)

            focus_day = monday + timedelta(weeks=week_offset, days=day_offset)
            end_h = int(start_h + dur_h)
            end_m = int((dur_h % 1) * 60)
            events.append(_vevent(
                summary=rng.choice(FOCUS_BLOCK_NAMES),
                dtstart=_fmt_dt(focus_day, start_h),
                dtend=_fmt_dt(focus_day, end_h, end_m),
                description="Deep work — no interruptions",
            ))

    # 7. Review / cross-functional meetings — profile-controlled total
    rev_min, rev_max = p["review_total"]
    num_reviews = rng.randint(rev_min, rev_max) if rev_max > 0 else 0
    review_keys: set[tuple[int, int]] = set()
    for _ in range(num_reviews * 3):
        week_offset = rng.randint(0, 3)
        day_offset = rng.randint(0, 4)
        slot = rng.choice(REVIEW_SLOTS)
        start_h, dur_h = slot
        key = (week_offset * 5 + day_offset, start_h)
        if key in review_keys:
            continue
        review_keys.add(key)

        review_day = monday + timedelta(weeks=week_offset, days=day_offset)
        end_h = int(start_h + dur_h)
        end_m = int((dur_h % 1) * 60)
        events.append(_vevent(
            summary=rng.choice(REVIEW_MEETING_NAMES),
            dtstart=_fmt_dt(review_day, start_h),
            dtend=_fmt_dt(review_day, end_h, end_m),
        ))

    # 8. OOO blocks — profile-controlled count over the next 12 weeks
    ooo_min, ooo_max = p["ooo_count"]
    num_ooo = rng.randint(ooo_min, ooo_max) if ooo_max > 0 else 0
    ooo_days: set[date] = set()
    for _ in range(num_ooo):
        week_offset = rng.randint(1, 11)
        day_offset = rng.randint(0, 4)
        ooo_day = monday + timedelta(weeks=week_offset, days=day_offset)
        if ooo_day not in ooo_days:
            ooo_days.add(ooo_day)
            events.append(_allday_vevent(
                summary=rng.choice(OOO_LABELS),
                d=ooo_day,
            ))

    # Wrap in VCALENDAR
    header = (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//Vantage//Team Calendar//EN\r\n"
        "CALSCALE:GREGORIAN\r\n"
        "METHOD:PUBLISH\r\n"
        f"X-WR-CALNAME:{name} — Work Calendar\r\n"
        "X-WR-TIMEZONE:UTC\r\n"
    )
    return (header + "".join(events) + "END:VCALENDAR\r\n").encode("utf-8")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    create_db_and_tables()
    ICS_DIR.mkdir(exist_ok=True)

    with Session(engine) as db:
        members = db.exec(select(TeamMember)).all()

    skipped = 0
    for member in members:
        if member.id in REAL_ICS_MEMBERS:
            skipped += 1
            continue

        # Use the trailing number from the member ID as the seed so that
        # members with IDs like "mem-001", "mem-002" get distinct seeds
        # (the previous int.from_bytes approach gave identical results because
        # all IDs share the same "mem-" prefix in the lower 32 bits).
        try:
            member_num = int(member.id.rsplit("-", 1)[-1])
        except ValueError:
            member_num = abs(hash(member.id)) % 1000
        rng = random.Random(member_num)
        profile = _assign_profile(member_num)

        # Generate ICS
        ics_bytes = _generate_ics(member, rng, profile)
        out_path = ICS_DIR / f"{member.id}.ics"
        out_path.write_bytes(ics_bytes)

        # Relative path from backend/ dir (as stored in DB)
        rel_path = f"ics/{member.id}.ics"

        # Run availability calculation on the generated ICS
        report = get_availability_report(
            ics_path=out_path,
            timezone="UTC",
        )

        # Persist to DB — same pipeline as POST /members/{id}/calendar/sync
        with Session(engine) as db:
            # Update ics_path so future /calendar/sync calls work
            row = db.get(TeamMember, member.id)
            if row:
                row.ics_path = rel_path
                db.add(row)
                db.commit()

            update_member_calendar_pct(db, member.id, report["availability_pct"])

            day_map = {
                "Monday": "monday", "Tuesday": "tuesday", "Wednesday": "wednesday",
                "Thursday": "thursday", "Friday": "friday",
            }
            per_day = {
                day_map[d["weekday"]]: round(d["availability_pct"])
                for d in report["per_day"]
                if d["weekday"] in day_map
            }
            update_member_week_availability(db, member.id, per_day)

        days_str = "  ".join(
            f"{k[:2].upper()}:{per_day.get(k, '?')}%" for k in
            ["monday", "tuesday", "wednesday", "thursday", "friday"]
        )
        print(
            f"  [ok]  {member.name:<22} "
            f"profile={profile:<16} "
            f"cal={report['availability_pct']:5.1f}%  {days_str}"
        )

    print(f"\nDone. {len(members) - skipped} ICS files generated and synced to DB. "
          f"{skipped} real ICS member(s) skipped.")


if __name__ == "__main__":
    main()

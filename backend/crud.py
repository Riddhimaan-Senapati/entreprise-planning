"""
crud.py
-------
Database CRUD helpers used by the FastAPI routers.
All functions accept a SQLModel Session and return typed Pydantic objects
(the *Out schemas from models.py) so routers stay thin.
"""

from __future__ import annotations

import difflib
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

from sqlmodel import Session, select

import uuid

from models import (
    MemberOOOChange, TimeOffSyncResult,
    Suggestion, SuggestionOut,
    Task, TaskCreate, TaskOut,
    TeamMember, TeamMemberOut,
    WeekAvailability, WeekAvailabilityOut,
    DataSourceSignalOut, SummaryOut,
)

if TYPE_CHECKING:
    from slack_parser import TimeOffEntry


# ── Private builders ───────────────────────────────────────────────────────────

def _week_avail_out(wa: WeekAvailability | None) -> WeekAvailabilityOut:
    if wa is None:
        return WeekAvailabilityOut(monday=0, tuesday=0, wednesday=0, thursday=0, friday=0)
    return WeekAvailabilityOut(
        monday=wa.monday, tuesday=wa.tuesday, wednesday=wa.wednesday,
        thursday=wa.thursday, friday=wa.friday,
    )


def _suggestion_out(s: Suggestion) -> SuggestionOut:
    return SuggestionOut(
        memberId=s.member_id,
        skillMatchPct=s.skill_match_pct,
        workloadPct=s.workload_pct,
        contextReason=s.context_reason,
    )


def _task_out(task: Task, db: Session) -> TaskOut:
    suggestions = db.exec(
        select(Suggestion)
        .where(Suggestion.task_id == task.id)
        .order_by(Suggestion.rank)
    ).all()
    return TaskOut(
        id=task.id,
        title=task.title,
        priority=task.priority,
        assigneeId=task.assignee_id,   # Optional[str]
        deadline=task.deadline,
        projectName=task.project_name,
        status=task.status,
        suggestions=[_suggestion_out(s) for s in suggestions],
    )


def _member_out(member: TeamMember, db: Session) -> TeamMemberOut:
    week_avail = db.exec(
        select(WeekAvailability).where(WeekAvailability.member_id == member.id)
    ).first()

    # Fetch non-covered tasks assigned to this member
    current_tasks = db.exec(
        select(Task).where(
            Task.assignee_id == member.id,
            Task.status != "covered",
        )
    ).all()

    return TeamMemberOut(
        id=member.id,
        name=member.name,
        role=member.role,
        team=member.team,
        confidenceScore=member.confidence_score,
        skills=member.skills or [],
        dataSources=DataSourceSignalOut(
            calendarPct=member.calendar_pct,
            taskLoadHours=member.task_load_hours,
            leaveStatus=member.leave_status,
        ),
        isOOO=member.is_ooo,
        lastSynced=member.last_synced,
        weekAvailability=_week_avail_out(week_avail),
        currentTasks=[_task_out(t, db) for t in current_tasks],
        icsLinked=bool(member.ics_path),
        manuallyOverridden=member.manually_overridden,
        managerNotes=member.manager_notes,
        slackOooStart=member.slack_ooo_start,
        slackOooUntil=member.slack_ooo_until,
    )


# ── Members ────────────────────────────────────────────────────────────────────

def get_all_members(db: Session) -> list[TeamMemberOut]:
    return [_member_out(m, db) for m in db.exec(select(TeamMember)).all()]


def get_member_row(db: Session, member_id: str) -> TeamMember | None:
    """Return the raw DB row (needed for e.g. ics_path access)."""
    return db.get(TeamMember, member_id)


def get_member_out(db: Session, member_id: str) -> TeamMemberOut | None:
    row = db.get(TeamMember, member_id)
    return _member_out(row, db) if row else None


def update_member_week_availability(
    db: Session,
    member_id: str,
    per_day: dict,          # {"monday": int, "tuesday": int, ...}
) -> WeekAvailability | None:
    """Persist per-day availability scores for a member (from ICS calculation)."""
    row = db.exec(
        select(WeekAvailability).where(WeekAvailability.member_id == member_id)
    ).first()
    if not row:
        return None
    row.monday    = per_day.get("monday",    row.monday)
    row.tuesday   = per_day.get("tuesday",   row.tuesday)
    row.wednesday = per_day.get("wednesday", row.wednesday)
    row.thursday  = per_day.get("thursday",  row.thursday)
    row.friday    = per_day.get("friday",    row.friday)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


_LEAVE_MULTIPLIER = {"available": 1.0, "partial": 0.5, "ooo": 0.0}


def _confidence_from_calendar(calendar_pct: float, leave_status: str) -> float:
    """
    confidence = calendar_pct × leave_multiplier

    For members with ICS files the OOO calendar blocks already push calendar_pct
    to 0, so the multiplier only matters for manual overrides on members without
    an ICS file.
    """
    multiplier = _LEAVE_MULTIPLIER.get(leave_status, 1.0)
    return round(calendar_pct * multiplier, 1)


def update_member_calendar_pct(
    db: Session,
    member_id: str,
    pct: float,
    also_update_confidence: bool = True,
) -> TeamMember | None:
    """
    Persist a new calendar_pct (from ICS calculation) for the member.
    When also_update_confidence=True, confidence_score is recalculated:

        confidence = calendar_pct × leave_multiplier
          where leave_multiplier = {available: 1.0, partial: 0.5, ooo: 0.0}
    """
    member = db.get(TeamMember, member_id)
    if not member:
        return None

    member.calendar_pct = round(pct, 1)
    member.last_synced = datetime.now(timezone.utc)

    if also_update_confidence:
        member.confidence_score = _confidence_from_calendar(
            member.calendar_pct, member.leave_status
        )

    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def update_member_override(
    db: Session,
    member_id: str,
    leave_status: str,
) -> TeamMember | None:
    """
    Persist a manual leave-status override and recompute confidence_score so
    overriding to 'ooo' immediately tanks the score even without an ICS sync.
    """
    member = db.get(TeamMember, member_id)
    if not member:
        return None

    member.leave_status = leave_status
    member.is_ooo = leave_status == "ooo"
    member.manually_overridden = True
    member.confidence_score = _confidence_from_calendar(member.calendar_pct, leave_status)
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def update_member_notes(
    db: Session,
    member_id: str,
    notes: str,
) -> TeamMember | None:
    """Persist manager notes for a member."""
    member = db.get(TeamMember, member_id)
    if not member:
        return None
    member.manager_notes = notes
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def update_member_skills(
    db: Session,
    member_id: str,
    skills: list[str],
) -> TeamMember | None:
    """Persist the skills list for a member."""
    member = db.get(TeamMember, member_id)
    if not member:
        return None
    member.skills = skills
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def reset_member_override(
    db: Session,
    member_id: str,
) -> TeamMember | None:
    """
    Clear a manual override: restore leave_status to 'available', is_ooo to False,
    and clear the manually_overridden flag.  If the member has an ICS file linked,
    callers should follow up with a calendar/sync to restore the real computed status.
    """
    member = db.get(TeamMember, member_id)
    if not member:
        return None

    member.leave_status = "available"
    member.is_ooo = False
    member.manually_overridden = False
    # Also clear any Slack-sourced OOO schedule so tick doesn't re-activate it
    member.slack_ooo_start = None
    member.slack_ooo_until = None
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


# ── Slack OOO scheduling ───────────────────────────────────────────────────────

def _ensure_utc(dt: datetime | None) -> datetime | None:
    """
    Make a datetime timezone-aware (UTC).  SQLite returns naive datetimes even
    when they were stored as UTC, so we attach the UTC tzinfo before comparing.
    """
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _parse_date_str(s: str | None) -> datetime | None:
    """Parse a Gemini-extracted date string (e.g. '2/24/2026') to UTC datetime."""
    if not s:
        return None
    try:
        from dateutil import parser as dparser
        dt = dparser.parse(s)
        return _ensure_utc(dt)
    except Exception:
        return None


def _best_member_match(username: str, all_members: list[TeamMember]) -> TeamMember | None:
    """Fuzzy-match a Slack display name to a TeamMember (ratio >= 0.75)."""
    norm = username.lstrip("@").replace(".", " ").strip().lower()
    if not norm:
        logger.warning("fuzzy-match: empty username after normalisation, skipping")
        return None
    best_ratio, best_member = 0.0, None
    for m in all_members:
        # Full name similarity
        full = difflib.SequenceMatcher(None, norm, m.name.lower()).ratio()
        # First name only similarity (catches "maya" → "Maya Patel")
        first = difflib.SequenceMatcher(None, norm, m.name.split()[0].lower()).ratio()
        ratio = max(full, first)
        if ratio > best_ratio:
            best_ratio, best_member = ratio, m
    if best_ratio >= 0.75:
        logger.info("fuzzy-match: %r → %r (ratio=%.2f)", username, best_member.name, best_ratio)
        return best_member
    logger.warning(
        "fuzzy-match: no match for %r — best was %r at ratio=%.2f (threshold 0.75)",
        username, best_member.name if best_member else None, best_ratio,
    )
    return None


_SLACK_ID_RE = re.compile(r"^[UW][A-Z0-9]{6,}$")


def _is_slack_user_id(s: str) -> bool:
    """Return True if s looks like a Slack user/workspace ID (e.g. U08ABC123)."""
    return bool(_SLACK_ID_RE.match(s))


def _member_by_slack_id(slack_id: str, all_members: list[TeamMember]) -> TeamMember | None:
    """Exact match on TeamMember.slack_user_id."""
    for m in all_members:
        if m.slack_user_id == slack_id:
            return m
    return None


def tick_slack_ooo_status(db: Session) -> tuple[list[str], list[str]]:
    """
    Activate pending Slack OOOs (start_date has arrived) and restore expired ones.
    Runs on server startup and before every GET /members so the UI is always current.
    Does not touch members with manually_overridden=True.

    Returns (activated_ids, restored_ids).
    """
    now = datetime.now(timezone.utc)
    activated: list[str] = []
    restored:  list[str] = []
    changed = False

    for m in db.exec(select(TeamMember)).all():
        if m.manually_overridden:
            continue

        # SQLite returns naive datetimes — normalise to UTC before comparing
        ooo_until = _ensure_utc(m.slack_ooo_until)
        ooo_start = _ensure_utc(m.slack_ooo_start)

        # Restore: OOO window has ended.
        # Compare calendar dates, not UTC datetimes — a date-only end like "2/22"
        # parses to midnight UTC, which would wrongly trigger a restore if the sync
        # runs even one second into that UTC day.
        if ooo_until is not None and ooo_until.date() < now.date():
        # Restore: OOO window has ended.
        # Compare calendar dates so an OOO ending "today" stays active all day,
        # matching the same logic used in apply_timeoff_entries.
        if ooo_until is not None and ooo_until.date() < now.date():
            m.leave_status = "available"
            m.is_ooo = False
            m.confidence_score = _confidence_from_calendar(m.calendar_pct, "available")
            m.slack_ooo_start = None
            m.slack_ooo_until = None
            db.add(m)
            restored.append(m.id)
            changed = True

        # Activate: start has arrived but leave_status not yet set to OOO
        elif ooo_start is not None and ooo_start <= now and m.leave_status != "ooo":
            m.leave_status = "ooo"
            m.is_ooo = True
            m.confidence_score = 0.0
            db.add(m)
            activated.append(m.id)
            changed = True

    if changed:
        db.commit()

    return activated, restored


def apply_timeoff_entries(
    db: Session,
    entries: list,  # list[TimeOffEntry] — avoid circular import at module level
) -> TimeOffSyncResult:
    """
    Match each time-off entry to a team member and persist their OOO schedule.
    Matching priority: exact Slack user ID (when person_username looks like U/W + alphanumeric)
    → fuzzy display name (SequenceMatcher ratio >= 0.75).
    Future OOOs are stored but not activated yet — tick_slack_ooo_status will activate them
    when start_date arrives.
    """
    now = datetime.now(timezone.utc)
    all_members = db.exec(select(TeamMember)).all()
    changes: list[MemberOOOChange] = []
    skipped = 0
    processed_ids: set[str] = set()  # deduplicate per member per sync run

    for entry in entries:
        start_dt = _parse_date_str(entry.start_date) or now
        end_dt   = _parse_date_str(entry.end_date)

        logger.info(
            "apply: person=%r start=%r→%s end=%r→%s  now=%s",
            entry.person_username,
            entry.start_date, start_dt.strftime("%Y-%m-%d %H:%M:%S %Z"),
            entry.end_date, end_dt.strftime("%Y-%m-%d %H:%M:%S %Z") if end_dt else None,
            now.strftime("%Y-%m-%d %H:%M:%S %Z"),
        )

        # Skip stale entries whose OOO window has fully passed.
        # Compare calendar dates (not datetimes) so an OOO ending "today" stays
        # valid for the whole day regardless of what time-of-day end_dt resolved to.
        if end_dt is not None and end_dt.date() < now.date():
            logger.warning(
                "SKIP person=%r — end_date %s (%s) is before today %s",
                entry.person_username, entry.end_date,
                end_dt.strftime("%Y-%m-%d %H:%M:%S %Z"), now.strftime("%Y-%m-%d"),
            )
            skipped += 1
            continue

        member = _best_member_match(entry.person_username, all_members)

        if not member:
            logger.warning("SKIP person=%r — no team member matched (fuzzy ratio < 0.75)", entry.person_username)
            skipped += 1
            continue

        # Don't overwrite manually-set overrides
        if member.manually_overridden:
            logger.warning("SKIP person=%r → member=%r — manually_overridden=True", entry.person_username, member.name)
            skipped += 1
            continue

        # Deduplicate: first match in the batch wins
        if member.id in processed_ids:
            logger.warning("SKIP person=%r → member=%r — duplicate in this batch", entry.person_username, member.name)
            skipped += 1
            continue
        processed_ids.add(member.id)

        member.slack_ooo_start = start_dt
        member.slack_ooo_until = end_dt
        member.manually_overridden = False

        is_pending = start_dt > now
        if not is_pending:
            member.leave_status = "ooo"
            member.is_ooo = True
            member.confidence_score = 0.0

        db.add(member)

        # Resolve coverage display name from DB when it's a Slack user ID
        coverage_display = entry.coverage_username
        if coverage_display and _is_slack_user_id(coverage_display):
            coverage_member = _member_by_slack_id(coverage_display, all_members)
            coverage_display = coverage_member.name if coverage_member else coverage_display

        changes.append(MemberOOOChange(
            memberId=member.id,
            memberName=member.name,
            personUsername=entry.person_username,
            startDate=entry.start_date,
            endDate=entry.end_date,
            reason=entry.reason,
            coverageBy=coverage_display,
            pending=is_pending,
        ))

    if changes:
        db.commit()

    return TimeOffSyncResult(
        detected=len(entries),
        applied=len(changes),
        pending=sum(1 for c in changes if c.pending),
        skipped=skipped,
        changes=changes,
    )


def simulate_timeoff_matching(
    db: Session,
    entries: list,
) -> dict[str, str]:
    """
    Dry-run version of apply_timeoff_entries.  Returns a mapping of
    entry index → human-readable match result string, with no DB writes.
    Used by GET /timeoff/debug.
    """
    now = datetime.now(timezone.utc)
    all_members = db.exec(select(TeamMember)).all()
    results: dict[str, str] = {}
    processed_ids: set[str] = set()

    for i, entry in enumerate(entries):
        key = str(i)
        start_dt = _parse_date_str(entry.start_date) or now
        end_dt   = _parse_date_str(entry.end_date)

        if end_dt is not None and end_dt.date() < now.date():
            results[key] = "skip:stale (OOO window already passed)"
            continue

        member = _best_member_match(entry.person_username, all_members)

        if not member:
            results[key] = f"skip:no_match (person={entry.person_username!r})"
            continue

        if member.manually_overridden:
            results[key] = f"skip:manual_override ({member.name})"
            continue

        if member.id in processed_ids:
            results[key] = f"skip:duplicate ({member.name})"
            continue

        processed_ids.add(member.id)
        is_pending = start_dt > now
        label = "pending" if is_pending else "apply_now"
        results[key] = f"matched:{member.id} ({member.name}) [{label}]"

    return results


# ── Tasks ──────────────────────────────────────────────────────────────────────

def create_task(db: Session, task_in: TaskCreate) -> Task:
    # Derive status: if assignee provided the task is already covered;
    # otherwise it's unassigned and the pipeline will find candidates.
    status = "covered" if task_in.assigneeId else "unassigned"
    task = Task(
        id=f"task-{uuid.uuid4().hex[:8]}",
        title=task_in.title,
        priority=task_in.priority,
        assignee_id=task_in.assigneeId,
        deadline=task_in.deadline,
        project_name=task_in.projectName,
        status=status,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task_id: str) -> bool:
    """Delete a task and all its suggestions. Returns True if found and deleted."""
    task = db.get(Task, task_id)
    if not task:
        return False
    for s in db.exec(select(Suggestion).where(Suggestion.task_id == task_id)).all():
        db.delete(s)
    db.delete(task)
    db.commit()
    return True


def unassign_task(db: Session, task_id: str) -> Task | None:
    """
    Remove the assignee from a task and set its status to 'unassigned'.
    Clears existing suggestions so the pipeline can write fresh ones.
    """
    task = db.get(Task, task_id)
    if not task:
        return None
    task.assignee_id = None
    task.status = "unassigned"
    # Clear stale suggestions — pipeline will repopulate
    for s in db.exec(select(Suggestion).where(Suggestion.task_id == task_id)).all():
        db.delete(s)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def get_all_tasks(db: Session, status_filter: str | None = None) -> list[TaskOut]:
    stmt = select(Task)
    if status_filter:
        stmt = stmt.where(Task.status == status_filter)
    return [_task_out(t, db) for t in db.exec(stmt).all()]


def get_task_out(db: Session, task_id: str) -> TaskOut | None:
    task = db.get(Task, task_id)
    return _task_out(task, db) if task else None


def assign_task(db: Session, task_id: str, member_id: str) -> Task | None:
    """Set a new assignee and mark the task as covered."""
    task = db.get(Task, task_id)
    if not task:
        return None
    task.assignee_id = member_id
    task.status = "covered"
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task_status(db: Session, task_id: str, status: str) -> Task | None:
    task = db.get(Task, task_id)
    if not task:
        return None
    task.status = status
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


# ── Summary ────────────────────────────────────────────────────────────────────

def get_summary(db: Session) -> SummaryOut:
    members = db.exec(select(TeamMember)).all()
    tasks   = db.exec(select(Task)).all()

    ooo             = sum(1 for m in members if m.is_ooo)
    fully_available = sum(1 for m in members if not m.is_ooo and m.leave_status == "available")
    critical_risk   = sum(1 for t in tasks if t.priority in ("P0", "P1") and t.status != "covered")
    unresolved      = sum(1 for t in tasks if t.status != "covered")
    latest_sync     = max(
        (m.last_synced for m in members),
        default=datetime.now(timezone.utc),
    )

    return SummaryOut(
        ooo=ooo,
        fullyAvailable=fully_available,
        criticalAtRisk=critical_risk,
        unresolvedReassignments=unresolved,
        lastSynced=latest_sync,
    )

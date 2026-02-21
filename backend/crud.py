"""
crud.py
-------
Database CRUD helpers used by the FastAPI routers.
All functions accept a SQLModel Session and return typed Pydantic objects
(the *Out schemas from models.py) so routers stay thin.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Session, select

from models import (
    Suggestion, SuggestionOut,
    Task, TaskOut,
    TeamMember, TeamMemberOut,
    WeekAvailability, WeekAvailabilityOut,
    DataSourceSignalOut, SummaryOut,
)


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
        assigneeId=task.assignee_id,
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


def update_member_calendar_pct(
    db: Session,
    member_id: str,
    pct: float,
    also_update_confidence: bool = True,
) -> TeamMember | None:
    """
    Persist a new calendar_pct (from ICS calculation) for the member.
    When also_update_confidence=True, confidence_score is recalculated so
    the frontend ring / sorting reflects the real availability:

        confidence = 0.6 * calendar_pct
                   + 0.25 * (1 - task_load_hours / 50) * 100
                   + 0.15 * leave_bonus
    """
    member = db.get(TeamMember, member_id)
    if not member:
        return None

    member.calendar_pct = round(pct, 1)
    member.last_synced = datetime.now(timezone.utc)

    if also_update_confidence:
        load_score   = max(0.0, (1 - member.task_load_hours / 50)) * 100
        leave_bonus  = {"available": 100.0, "partial": 50.0, "ooo": 0.0}.get(
            member.leave_status, 100.0
        )
        member.confidence_score = round(
            0.6 * member.calendar_pct
            + 0.25 * load_score
            + 0.15 * leave_bonus,
            1,
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
    """Persist a manual leave-status override and update is_ooo accordingly."""
    member = db.get(TeamMember, member_id)
    if not member:
        return None

    member.leave_status = leave_status
    member.is_ooo = leave_status == "ooo"
    member.manually_overridden = True
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
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


# ── Tasks ──────────────────────────────────────────────────────────────────────

def get_all_tasks(db: Session, status_filter: str | None = None) -> list[TaskOut]:
    stmt = select(Task)
    if status_filter:
        stmt = stmt.where(Task.status == status_filter)
    return [_task_out(t, db) for t in db.exec(stmt).all()]


def get_task_out(db: Session, task_id: str) -> TaskOut | None:
    task = db.get(Task, task_id)
    return _task_out(task, db) if task else None


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
    partial         = sum(1 for m in members if not m.is_ooo and m.leave_status == "partial")
    fully_available = sum(1 for m in members if not m.is_ooo and m.leave_status == "available")
    critical_risk   = sum(1 for t in tasks if t.priority in ("P0", "P1") and t.status != "covered")
    unresolved      = sum(1 for t in tasks if t.status != "covered")
    latest_sync     = max(
        (m.last_synced for m in members),
        default=datetime.now(timezone.utc),
    )

    return SummaryOut(
        ooo=ooo,
        partial=partial,
        fullyAvailable=fully_available,
        criticalAtRisk=critical_risk,
        unresolvedReassignments=unresolved,
        lastSynced=latest_sync,
    )

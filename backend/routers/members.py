"""
routers/members.py
------------------
FastAPI router for all /members endpoints.

Routes:
    GET  /members                        → list all members
    GET  /members/{id}                   → single member
    PATCH /members/{id}/override         → manual leave-status override
    GET  /members/{id}/availability      → live ICS availability report (no DB write)
    POST /members/{id}/calendar/sync     → re-run ICS calc and persist to DB
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from calendar_availability import get_availability_report
from crud import (
    get_all_members,
    get_member_out,
    get_member_row,
    reset_member_override,
    tick_slack_ooo_status,
    update_member_calendar_pct,
    update_member_notes,
    update_member_override,
    update_member_skills,
    update_member_week_availability,
)
from database import get_session
from models import NotesUpdate, OverrideUpdate, SkillsUpdate, TeamMemberOut

router = APIRouter(prefix="/members", tags=["members"])

# Backend root — ICS paths stored in DB are relative to this directory
_BACKEND_DIR = Path(__file__).parent.parent


@router.get("", response_model=list[TeamMemberOut])
def list_members(db: Session = Depends(get_session)):
    # Activate any pending Slack OOOs whose start date has arrived and
    # restore any that have expired — keeps the UI current without manual action.
    tick_slack_ooo_status(db)
    return get_all_members(db)


@router.get("/{member_id}", response_model=TeamMemberOut)
def get_member(member_id: str, db: Session = Depends(get_session)):
    out = get_member_out(db, member_id)
    if not out:
        raise HTTPException(status_code=404, detail="Member not found")
    return out


@router.patch("/{member_id}/override", response_model=TeamMemberOut)
def override_member(
    member_id: str,
    body: OverrideUpdate,
    db: Session = Depends(get_session),
):
    valid = {"available", "ooo"}
    if body.leaveStatus not in valid:
        raise HTTPException(
            status_code=422,
            detail=f"leaveStatus must be one of {sorted(valid)}",
        )
    row = update_member_override(db, member_id, body.leaveStatus)
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_out(db, member_id)


@router.delete("/{member_id}/override", response_model=TeamMemberOut)
def clear_member_override(member_id: str, db: Session = Depends(get_session)):
    """
    Remove a manual leave-status override, resetting the member to 'available'.
    If the member has an ICS file linked, call /calendar/sync afterwards to
    restore the real computed availability.
    """
    row = reset_member_override(db, member_id)
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_out(db, member_id)


@router.patch("/{member_id}/skills", response_model=TeamMemberOut)
def update_skills(
    member_id: str,
    body: SkillsUpdate,
    db: Session = Depends(get_session),
):
    """Persist skills list for a team member."""
    row = update_member_skills(db, member_id, body.skills)
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_out(db, member_id)


@router.patch("/{member_id}/notes", response_model=TeamMemberOut)
def update_notes(
    member_id: str,
    body: NotesUpdate,
    db: Session = Depends(get_session),
):
    """Persist manager notes for a team member."""
    row = update_member_notes(db, member_id, body.notes)
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_out(db, member_id)


@router.get("/{member_id}/availability")
def member_availability(member_id: str, db: Session = Depends(get_session)):
    """
    Returns the raw availability report from the member's linked ICS file
    without writing anything to the database.  Use the /calendar/sync endpoint
    to also persist the result.
    """
    row = get_member_row(db, member_id)
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    if not row.ics_path:
        raise HTTPException(
            status_code=404, detail="No ICS file linked for this member"
        )
    ics_path = _BACKEND_DIR / row.ics_path
    if not ics_path.exists():
        raise HTTPException(
            status_code=404, detail=f"ICS file not found: {row.ics_path}"
        )
    return get_availability_report(ics_path=ics_path)


@router.post("/{member_id}/calendar/sync", response_model=TeamMemberOut)
def sync_member_calendar(member_id: str, db: Session = Depends(get_session)):
    """
    Re-runs the ICS availability calculation and persists the result to the
    database, recomputing the member's confidence_score.
    """
    row = get_member_row(db, member_id)
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    if not row.ics_path:
        raise HTTPException(
            status_code=422, detail="No ICS file linked for this member"
        )
    ics_path = _BACKEND_DIR / row.ics_path
    if not ics_path.exists():
        raise HTTPException(
            status_code=404, detail=f"ICS file not found: {row.ics_path}"
        )
    report = get_availability_report(ics_path=ics_path)
    update_member_calendar_pct(db, member_id, report["availability_pct"])

    # Also persist per-day availability so weekAvailability reflects real calendar
    day_map = {
        "Monday": "monday", "Tuesday": "tuesday", "Wednesday": "wednesday",
        "Thursday": "thursday", "Friday": "friday",
    }
    per_day = {day_map[d["weekday"]]: round(d["availability_pct"])
               for d in report["per_day"] if d["weekday"] in day_map}
    update_member_week_availability(db, member_id, per_day)

    return get_member_out(db, member_id)

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
    update_member_calendar_pct,
    update_member_override,
)
from database import get_session
from models import OverrideUpdate, TeamMemberOut

router = APIRouter(prefix="/members", tags=["members"])

# Backend root — ICS paths stored in DB are relative to this directory
_BACKEND_DIR = Path(__file__).parent.parent


@router.get("", response_model=list[TeamMemberOut])
def list_members(db: Session = Depends(get_session)):
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
    valid = {"available", "partial", "ooo"}
    if body.leaveStatus not in valid:
        raise HTTPException(
            status_code=422,
            detail=f"leaveStatus must be one of {sorted(valid)}",
        )
    row = update_member_override(db, member_id, body.leaveStatus)
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
    return get_member_out(db, member_id)

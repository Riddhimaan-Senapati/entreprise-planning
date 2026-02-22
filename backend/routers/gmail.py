"""
routers/gmail.py
----------------
FastAPI router for Gmail-based OOO scanning.

Routes:
    POST /gmail/scan   → scan the inbox, update DB, return TimeOffSyncResult
    GET  /gmail/debug  → dry-run: show per-email trace without DB writes
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from crud import _best_member_match, _parse_date_str, apply_timeoff_entries, tick_slack_ooo_status
from database import get_session
from gmail_parser import fetch_and_parse_gmail, fetch_and_parse_gmail_debug, is_gmail_configured
from models import TeamMember, TimeOffSyncResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gmail", tags=["gmail"])


@router.post(
    "/scan",
    response_model=TimeOffSyncResult,
    summary="Scan Gmail inbox for OOO emails",
    description=(
        "Queries Gmail for emails matching OOO-related keywords (pre-filtered before "
        "reaching Gemini), classifies each with Gemini AI, and persists any detected "
        "OOO schedules to the database using the same pipeline as the Slack integration. "
        "Future OOOs are stored as pending and activated automatically when their start "
        "date arrives. Requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and "
        "GMAIL_REFRESH_TOKEN in .env — run gmail_oauth_setup.py once to obtain them."
    ),
)
def scan_gmail(
    max_results: int = Query(
        default=100,
        ge=1,
        le=500,
        description="Max emails to retrieve from the Gmail OOO keyword search.",
    ),
    db: Session = Depends(get_session),
) -> TimeOffSyncResult:
    logger.info("POST /gmail/scan max_results=%d", max_results)

    if not is_gmail_configured():
        logger.warning("Gmail not configured — returning 503")
        raise HTTPException(
            status_code=503,
            detail=(
                "Gmail is not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, "
                "and GMAIL_REFRESH_TOKEN to backend/.env. "
                "Run `python gmail_oauth_setup.py` from the backend directory to obtain "
                "your refresh token."
            ),
        )

    try:
        entries = fetch_and_parse_gmail(max_results=max_results)
    except Exception as exc:
        logger.error("Gmail API error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=f"Gmail API error: {exc}",
        ) from exc

    # Reuse the same DB update logic as the Slack integration
    result = apply_timeoff_entries(db, entries)

    # Run the OOO scheduler so any entries whose start_date has arrived
    # are immediately activated (is_ooo = True, leave_status = "ooo")
    tick_slack_ooo_status(db)

    logger.info(
        "Gmail scan result: detected=%d applied=%d pending=%d skipped=%d",
        result.detected, result.applied, result.pending, result.skipped,
    )
    return result


@router.get(
    "/debug",
    summary="Debug Gmail OOO scan (no DB writes)",
    description=(
        "Runs the Gmail search + Gemini classification pipeline and returns a "
        "per-email trace showing exactly what the search found, what Gemini "
        "extracted, which team member each OOO would match, and whether the "
        "stale-date check would skip it — without writing anything to the database."
    ),
)
def debug_gmail(
    max_results: int = Query(
        default=20,
        ge=1,
        le=100,
        description="Max emails to retrieve from the Gmail OOO keyword search.",
    ),
    db: Session = Depends(get_session),
) -> dict:
    if not is_gmail_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Gmail is not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, "
                "and GMAIL_REFRESH_TOKEN to backend/.env."
            ),
        )

    try:
        search_query, search_days, found, traces = fetch_and_parse_gmail_debug(
            max_results=max_results
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gmail API error: {exc}",
        ) from exc

    now          = datetime.now(timezone.utc)
    all_members  = db.exec(select(TeamMember)).all()
    emails_out   = []

    for trace in traces:
        entry = trace.model_dump()

        if trace.is_ooo:
            name   = trace.person_name or trace.sender_name
            member = _best_member_match(name, all_members)
            entry["match_result"] = member.name if member else "NO MATCH"

            end_dt = _parse_date_str(trace.end_date)
            if end_dt is not None:
                would_skip = end_dt.date() < now.date()
                entry["stale_check"] = (
                    f"end_dt={end_dt.date().isoformat()}  now={now.date().isoformat()}  "
                    f"would_skip={would_skip}"
                )
            else:
                entry["stale_check"] = "no end_date — not skipped"
        else:
            entry["match_result"] = None
            entry["stale_check"]  = None

        emails_out.append(entry)

    return {
        "search_query":  search_query,
        "search_days":   search_days,
        "emails_found":  found,
        "now_utc":       now.isoformat(),
        "emails":        emails_out,
    }

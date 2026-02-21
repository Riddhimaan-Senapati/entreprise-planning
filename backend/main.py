"""
FastAPI server — CoverageIQ API

Coverage-intelligence endpoints (new):
    GET  /health                          → liveness check
    GET  /summary                         → team availability summary counts
    GET  /members                         → all 24 team members with availability
    GET  /members/{id}                    → single member
    PATCH /members/{id}/override          → manual leave-status override
    GET  /members/{id}/availability       → live ICS-based availability report
    POST /members/{id}/calendar/sync      → re-sync ICS and update confidence_score
    GET  /tasks                           → all at-risk tasks with suggestions
    GET  /tasks/{id}                      → single task
    PATCH /tasks/{id}/status              → update task status

Slack / time-off endpoints (existing):
    GET  /timeoff                         → fetch last 24h Slack time-off entries
    POST /ping                            → DM a team member to check availability
"""

import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime

# Force UTF-8 on Windows
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from sqlmodel import Session

from database import create_db_and_tables, engine, get_session
from models import SummaryOut
from crud import get_summary
from routers.members import router as members_router
from routers.tasks import router as tasks_router
from seed import seed
from slack_parser import TimeOffEntry, fetch_and_parse

load_dotenv()

# ── Env ────────────────────────────────────────────────────────────────────────
SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN")
SLACK_CHANNEL_ID = os.getenv("SLACK_CHANNEL_ID")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Dummy Slack user ID used for all availability pings while real user mapping is
# not yet set up. Replace with a real Slack member ID (e.g. U012AB3CD) in .env.
SLACK_PING_USER_ID = os.getenv("SLACK_PING_USER_ID", "")

if GEMINI_API_KEY and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY

missing = [k for k, v in {
    "SLACK_BOT_TOKEN": SLACK_BOT_TOKEN,
    "SLACK_CHANNEL_ID": SLACK_CHANNEL_ID,
    "GEMINI_API_KEY": GEMINI_API_KEY,
}.items() if not v]

if missing:
    raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")

# ── Slack client (shared, created once at startup) ─────────────────────────────
slack_client = WebClient(token=SLACK_BOT_TOKEN)


# ── Lifespan: init DB and seed on first boot ───────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    with Session(engine) as db:
        seed(db)  # no-op if already seeded
    yield


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="CoverageIQ API",
    description=(
        "Team coverage intelligence: real-time member availability from ICS calendars, "
        "Slack time-off parsing via Gemini AI, and task triage suggestions."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

# ── DB routers ─────────────────────────────────────────────────────────────────
app.include_router(members_router)
app.include_router(tasks_router)


# ── Core routes ────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/summary", response_model=SummaryOut)
def summary(db: Session = Depends(get_session)):
    return get_summary(db)


# ── Slack / time-off routes ────────────────────────────────────────────────────
@app.get(
    "/timeoff",
    response_model=list[TimeOffEntry],
    summary="Get time-off announcements",
    description=(
        "Fetches recent Slack messages and returns a JSON list of detected "
        "time-off entries. Only messages that Gemini classifies as time-off "
        "requests or announcements are included."
    ),
)
def get_timeoff(
    hours: int = Query(default=24, ge=1, le=720, description="How many hours back to look"),
    limit: int = Query(default=100, ge=1, le=999, description="Max messages to fetch from Slack"),
):
    try:
        entries = fetch_and_parse(
            slack=slack_client,
            channel_id=SLACK_CHANNEL_ID,
            hours_back=hours,
            limit=limit,
        )
    except SlackApiError as e:
        raise HTTPException(status_code=502, detail=f"Slack error: {e.response['error']}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return entries


# ── Availability ping ───────────────────────────────────────────────────────────

class PingRequest(BaseModel):
    member_name: str
    """Display name of the person being asked (e.g. 'Jordan Lee')."""

    task_title: str
    """Title of the task that needs coverage."""

    project_name: str = ""
    """Project the task belongs to."""

    priority: str = "P1"
    """Task priority label: P0, P1, or P2."""

    deadline: str = ""
    """ISO 8601 deadline string (e.g. '2026-02-22T17:00:00Z')."""

    context_reason: str = ""
    """Why this person was suggested (shown in the DM for context)."""


class PingResponse(BaseModel):
    ok: bool
    message_ts: str
    channel: str


@app.post(
    "/ping",
    response_model=PingResponse,
    summary="Send an availability check DM",
    description=(
        "Opens a Slack DM with SLACK_PING_USER_ID (a single dummy user while real "
        "per-member Slack IDs are not yet wired up) and sends a formatted availability "
        "check message for the given task. Called by the 'Check availability' button "
        "in the CoverageIQ frontend."
    ),
)
def post_ping(body: PingRequest):
    if not SLACK_PING_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="SLACK_PING_USER_ID is not set in .env. Add a real Slack member ID (e.g. U012AB3CD).",
        )

    # ── Parse deadline ──────────────────────────────────────────────────────────
    deadline_formatted = "(not specified)"
    is_urgent = False
    if body.deadline:
        try:
            dt = datetime.fromisoformat(body.deadline.replace("Z", "+00:00"))
            hours_left = (dt.timestamp() - datetime.utcnow().timestamp()) / 3600
            is_urgent = hours_left < 48
            deadline_formatted = dt.strftime("%a, %b %-d at %-I:%M %p UTC")
        except ValueError:
            deadline_formatted = body.deadline

    priority_emoji = {"P0": ":red_circle:", "P1": ":large_yellow_circle:", "P2": ":large_green_circle:"}.get(
        body.priority, ":white_circle:"
    )
    first_name = body.member_name.split()[0] if body.member_name else "there"
    header_text = "🚨 Urgent coverage check" if is_urgent else "📋 Coverage check"

    # ── Open DM channel ─────────────────────────────────────────────────────────
    try:
        dm = slack_client.conversations_open(users=[SLACK_PING_USER_ID])
    except SlackApiError as e:
        raise HTTPException(status_code=502, detail=f"conversations_open failed: {e.response['error']}")

    dm_channel = dm["channel"]["id"]

    # ── Send message ────────────────────────────────────────────────────────────
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": header_text, "emoji": True},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"Hey {first_name}! Your team lead is checking if you can cover a task"
                    + (" — *this is time-sensitive*" if is_urgent else "") + "."
                ),
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{priority_emoji} *{body.task_title}*\n_{body.project_name}_",
            },
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Deadline*\n{deadline_formatted}" + (" ⚠️" if is_urgent else "")},
                {"type": "mrkdwn", "text": f"*Priority*\n{priority_emoji} {body.priority}"},
            ],
        },
    ]

    if body.context_reason:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Why you were suggested*\n{body.context_reason}"},
        })

    blocks += [
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "Please *reply in this thread* to confirm or decline. Your team lead will finalise coverage once they hear back.",
            },
        },
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": ":robot_face: Sent from *CoverageIQ* · Enterprise Planning"}],
        },
    ]

    fallback = (
        f"Hey {first_name}! Can you cover '{body.task_title}' ({body.priority} · {body.project_name})? "
        f"Deadline: {deadline_formatted}."
    )

    try:
        result = slack_client.chat_postMessage(
            channel=dm_channel,
            text=fallback,
            blocks=blocks,
        )
    except SlackApiError as e:
        raise HTTPException(status_code=502, detail=f"chat_postMessage failed: {e.response['error']}")

    return PingResponse(ok=True, message_ts=result["ts"], channel=dm_channel)

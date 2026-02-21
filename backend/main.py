"""
FastAPI server — Slack Time-Off API

Endpoints:
    GET /timeoff          → fetch last 24h, return list of time-off entries
    GET /timeoff?hours=48 → look back further
    GET /timeoff?limit=50 → cap messages fetched
    GET /health           → liveness check
"""

import os
import sys

# Force UTF-8 on Windows
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from slack_parser import TimeOffEntry, fetch_and_parse

load_dotenv()

# ── Env ────────────────────────────────────────────────────────────────────────
SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN")
SLACK_CHANNEL_ID = os.getenv("SLACK_CHANNEL_ID")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

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

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Slack Time-Off API",
    description="Reads a Slack channel and extracts time-off announcements using Gemini.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


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

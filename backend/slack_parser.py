"""
Core Slack time-off parsing logic.
Shared between the CLI (fetch_timeoff.py) and the FastAPI server (main.py).
"""

import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel
from pydantic_ai import Agent

# Load env and map GEMINI_API_KEY → GOOGLE_API_KEY before the Agent is created
load_dotenv()
if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
from pydantic_ai.exceptions import ModelHTTPError
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

# ── Config ─────────────────────────────────────────────────────────────────────
GEMINI_MODEL = "google-gla:gemini-2.5-flash"
INTER_CALL_DELAY_SECONDS = 4  # stay safely under 15 RPM free-tier limit
MAX_RETRIES = 4

# ── Pydantic model returned by Gemini ─────────────────────────────────────────
class TimeOffDetails(BaseModel):
    """Structured output from Gemini for a single Slack message."""
    is_time_off_request: bool

    person_username: Optional[str] = None
    """Slack display name of the person taking time off."""

    start_date: Optional[str] = None
    """Full start date including year (e.g. '2/21/2026')."""

    end_date: Optional[str] = None
    """Full end/return date including year. Null if not mentioned."""

    reason: Optional[str] = None
    """Reason for time off, if stated."""

    coverage_username: Optional[str] = None
    """Name/username of who covers. Use @display_name for Slack mentions,
    plain text name otherwise. Null only if nobody is mentioned."""

    notes: Optional[str] = None
    """Any other relevant details."""


# ── API response model ─────────────────────────────────────────────────────────
class TimeOffEntry(BaseModel):
    """A single detected time-off entry returned by the API."""
    sent_at: str
    sender: str
    message: str
    person_username: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    reason: Optional[str] = None
    coverage_username: Optional[str] = None
    notes: Optional[str] = None


# ── Pydantic AI agent ──────────────────────────────────────────────────────────
agent = Agent(
    GEMINI_MODEL,
    output_type=TimeOffDetails,
    system_prompt=(
        "You are an HR assistant that reads Slack messages and extracts time-off information. "
        "You will be given the message text, the Slack username of the sender, and the exact "
        "date and time the message was sent. "
        "Use the message sent date to resolve any partial or relative dates to full dates "
        "including the correct year (e.g. '2/21' sent in 2026 → '2/21/2026', "
        "'next Monday' sent on 2026-02-21 → '2/23/2026'). "
        "Determine if the message is a time-off request or announcement. "
        "If it is, extract: who is taking time off (use the sender's username unless the message "
        "clearly states someone else), the full start and end dates (with year), the reason if "
        "mentioned, and who will cover their work. "
        "For coverage: if the person was @mentioned, use their resolved display name; "
        "if they were named in plain text, use that name as written. "
        "Only set coverage_username to null if no coverage person is mentioned at all. "
        "If the message is not about time off (e.g. general chat, a question, a system event), "
        "set is_time_off_request to false and leave all other fields null."
    ),
)

# ── User resolution ────────────────────────────────────────────────────────────
_user_cache: dict[str, str] = {}


def resolve_user(client: WebClient, user_id: str) -> str:
    """Return the best display name for a Slack user ID, with in-memory cache."""
    if user_id in _user_cache:
        return _user_cache[user_id]
    try:
        resp = client.users_info(user=user_id)
        profile = resp["user"]["profile"]
        name = (
            profile.get("display_name")
            or profile.get("real_name")
            or resp["user"].get("name")
            or user_id
        )
    except SlackApiError:
        name = user_id
    _user_cache[user_id] = name
    return name


def resolve_mentions(text: str, client: WebClient) -> str:
    """Replace <@USERID> Slack mention tokens with @display_name."""
    def replacer(match: re.Match) -> str:
        return f"@{resolve_user(client, match.group(1))}"
    return re.sub(r"<@([A-Z0-9]+)>", replacer, text)


# ── Helpers ────────────────────────────────────────────────────────────────────
def ts_to_datetime(ts: str) -> datetime:
    return datetime.fromtimestamp(float(ts), tz=timezone.utc)


def format_datetime(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S UTC")


def _retry_delay_from_error(exc: ModelHTTPError) -> int:
    """Parse the suggested retry-after seconds from a Gemini 429 body."""
    try:
        for d in exc.body.get("error", {}).get("details", []):
            if "RetryInfo" in d.get("@type", ""):
                return int(d.get("retryDelay", "60s").rstrip("s")) + 5
    except Exception:
        pass
    return 65


# ── Core parsing ───────────────────────────────────────────────────────────────
def parse_message(resolved_text: str, sender_name: str, sent_at: datetime) -> TimeOffDetails:
    """Run a single message through Gemini, retrying on 429."""
    prompt = (
        f"Sender Slack username : @{sender_name}\n"
        f"Message sent at       : {format_datetime(sent_at)} (year: {sent_at.year})\n\n"
        f"Message:\n{resolved_text}"
    )
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return agent.run_sync(prompt).output
        except ModelHTTPError as e:
            if e.status_code == 429 and attempt < MAX_RETRIES:
                wait = _retry_delay_from_error(e)
                time.sleep(wait)
            else:
                raise


def fetch_and_parse(
    slack: WebClient,
    channel_id: str,
    hours_back: int = 24,
    limit: int = 100,
) -> list[TimeOffEntry]:
    """
    Fetch messages from a Slack channel and return only time-off entries.

    Args:
        slack:      Authenticated Slack WebClient.
        channel_id: Slack channel ID to read from.
        hours_back: How far back to look (default 24 hours).
        limit:      Max messages to fetch (default 100).

    Returns:
        List of TimeOffEntry objects (only detected time-off messages).
    """
    now = datetime.now(tz=timezone.utc)
    oldest_ts = str(now.timestamp() - hours_back * 3600)

    resp = slack.conversations_history(channel=channel_id, oldest=oldest_ts, limit=limit)
    messages = list(reversed(resp.get("messages", [])))

    # Skip system subtypes (joins, bot integrations, etc.)
    human_messages = [
        m for m in messages
        if m.get("type") == "message" and not m.get("subtype")
    ]

    entries: list[TimeOffEntry] = []

    for i, msg in enumerate(human_messages):
        raw_text = msg.get("text", "").strip()
        if not raw_text:
            continue

        sent_at = ts_to_datetime(msg["ts"])
        sender_id = msg.get("user", "")
        sender_name = resolve_user(slack, sender_id) if sender_id else "unknown"
        resolved_text = resolve_mentions(raw_text, slack)

        details = parse_message(resolved_text, sender_name, sent_at)

        if details.is_time_off_request:
            person = (details.person_username or sender_name).lstrip("@")
            coverage = details.coverage_username.lstrip("@") if details.coverage_username else None
            entries.append(TimeOffEntry(
                sent_at=sent_at.isoformat(),
                sender=sender_name,
                message=raw_text,
                person_username=person,
                start_date=details.start_date,
                end_date=details.end_date,
                reason=details.reason,
                coverage_username=coverage,
                notes=details.notes,
            ))

        # Rate-limit spacing between Gemini calls (skip after last message)
        if i < len(human_messages) - 1:
            time.sleep(INTER_CALL_DELAY_SECONDS)

    return entries

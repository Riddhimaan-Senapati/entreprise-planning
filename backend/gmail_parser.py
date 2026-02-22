"""
gmail_parser.py
---------------
Reads an authenticated Gmail inbox and extracts OOO (out-of-office) signals using Gemini AI.

Mirrors the pattern from slack_parser.py so the results are compatible with
crud.apply_timeoff_entries(), which handles all the DB updates.

Gmail auth uses stored OAuth 2.0 credentials (refresh token).
Run gmail_oauth_setup.py ONCE to obtain your refresh token, then add these
three variables to backend/.env:

    GMAIL_CLIENT_ID=...
    GMAIL_CLIENT_SECRET=...
    GMAIL_REFRESH_TOKEN=...

Optionally:
    GMAIL_USER_EMAIL=me            # "me" means the authenticated account
    GMAIL_SEARCH_DAYS=30           # look back this many days (default 30)
"""

import base64
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

# Map GEMINI_API_KEY → GOOGLE_API_KEY before the Agent is created (same as slack_parser.py)
if os.getenv("GEMINI_API_KEY") and not os.getenv("GOOGLE_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError

logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

GEMINI_MODEL = "google-gla:gemini-2.5-flash"
INTER_CALL_DELAY_SECONDS = 4   # stay safely under 15 RPM free-tier limit
MAX_RETRIES = 4

# Pre-filter query sent to the Gmail search API.
# Only emails matching these OOO-related keywords reach Gemini, which:
#   - drastically reduces the number of Gemini API calls
#   - caps latency to a manageable level even with max_results=10
_SEARCH_DAYS = int(os.getenv("GMAIL_SEARCH_DAYS", "30"))
GMAIL_SEARCH_QUERY = (
    f"category:primary "
    f"(subject:(OOO OR \"out of office\" OR vacation OR \"on leave\" OR "
    f"\"time off\" OR \"away from office\" OR \"annual leave\" OR "
    f"\"sick leave\" OR \"working from home\" OR WFH OR \"day off\" OR "
    f"\"taking off\" OR absent) "
    f"OR (\"out of office\" OR \"OOO\" OR \"vacation\" OR \"on leave\" OR "
    f"\"not available\" OR \"unavailable\" OR \"day off\" OR "
    f"\"taking the day off\" OR \"taking off\" OR \"absent\" OR "
    f"\"out sick\" OR \"not in\")) "
    f"newer_than:{_SEARCH_DAYS}d"
)

# ── Env ────────────────────────────────────────────────────────────────────────

GMAIL_CLIENT_ID     = os.getenv("GMAIL_CLIENT_ID", "")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET", "")
GMAIL_REFRESH_TOKEN = os.getenv("GMAIL_REFRESH_TOKEN", "")
GMAIL_USER_EMAIL    = os.getenv("GMAIL_USER_EMAIL", "me")


def is_gmail_configured() -> bool:
    """True when all three OAuth credentials are present in the environment."""
    return bool(GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN)


def build_gmail_service():
    """
    Build an authenticated Gmail API service using stored OAuth2 credentials.
    The google-auth library automatically refreshes the access token when it expires.
    """
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=None,                               # no cached access token; will be refreshed
        refresh_token=GMAIL_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GMAIL_CLIENT_ID,
        client_secret=GMAIL_CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
    )
    return build("gmail", "v1", credentials=creds)


# ── Gemini OOO detection model ────────────────────────────────────────────────

class EmailOOODetails(BaseModel):
    """Structured output from Gemini for a single email."""

    is_ooo: bool
    """True if this email indicates someone will be out of office / unavailable."""

    person_name: Optional[str] = None
    """Name of the person who is OOO (defaults to sender unless the email is on behalf of someone else)."""

    start_date: Optional[str] = None
    """Full OOO start date including year, e.g. '2/24/2026'."""

    end_date: Optional[str] = None
    """Full return/end date including year. None if not stated."""

    reason: Optional[str] = None
    """Reason for absence, if mentioned (e.g. 'vacation', 'sick leave', 'conference')."""

    notes: Optional[str] = None
    """Any other relevant details extracted from the email."""


# ── Pydantic AI agent ──────────────────────────────────────────────────────────

_ooo_agent = Agent(
    GEMINI_MODEL,
    output_type=EmailOOODetails,
    system_prompt=(
        "You are an HR assistant that reads emails and determines whether someone is going "
        "Out Of Office (OOO) or will otherwise be unavailable. "
        "You will receive the email's subject, sender name, sender email address, body text, "
        "and the exact date and time the email was sent. "
        "Use the sent date to resolve any relative or partial dates to full calendar dates "
        "including the correct year "
        "(e.g. 'next Friday' sent on 2026-02-21 (Saturday) → '2026-02-27', "
        "'next Monday' sent on a Monday → the following Monday). "
        "Classify the email as OOO if it contains: vacation/holiday announcements, sick-leave "
        "messages, 'I will not be available', conference/travel notices, auto-reply OOO messages, "
        "parental leave, or any indication the sender (or someone they mention) will be absent. "
        "Extract: who is OOO (default to the sender), the full start date and end/return date "
        "(with year), and the reason if stated. "
        "If the email is an auto-reply OOO message, extract the return date from it. "
        "If the email is a regular business email, newsletter, code review, meeting invite "
        "without absence info, or any non-OOO content, set is_ooo to false and leave all "
        "other fields null."
    ),
)


# ── Gemini retry helper ────────────────────────────────────────────────────────

def _retry_delay_from_error(exc: ModelHTTPError) -> int:
    """Parse the suggested retry-after seconds from a Gemini 429 response body."""
    try:
        for d in exc.body.get("error", {}).get("details", []):
            if "RetryInfo" in d.get("@type", ""):
                return int(d.get("retryDelay", "60s").rstrip("s")) + 5
    except Exception:
        pass
    return 65


def _parse_email_for_ooo(
    subject: str,
    sender_name: str,
    sender_email: str,
    body: str,
    sent_at: datetime,
) -> EmailOOODetails:
    """Run a single email through Gemini to detect OOO, retrying on rate-limit errors."""
    body_preview = body[:2500].strip()
    prompt = (
        f"Email sent at : {sent_at.strftime('%Y-%m-%d %H:%M:%S UTC')} (year: {sent_at.year})\n"
        f"Sender name  : {sender_name}\n"
        f"Sender email : {sender_email}\n"
        f"Subject      : {subject}\n\n"
        f"Body:\n{body_preview}"
    )
    for attempt in range(1, MAX_RETRIES + 1):
        logger.debug("Gemini attempt %d/%d for subject=%r", attempt, MAX_RETRIES, subject)
        try:
            result = _ooo_agent.run_sync(prompt).output
            logger.debug(
                "Gemini result: is_ooo=%s person=%r start=%r end=%r (subject=%r)",
                result.is_ooo, result.person_name, result.start_date, result.end_date, subject,
            )
            return result
        except ModelHTTPError as e:
            if e.status_code == 429 and attempt < MAX_RETRIES:
                wait = _retry_delay_from_error(e)
                logger.warning(
                    "Gemini 429 rate-limit, retrying in %ds (attempt %d/%d) for subject=%r",
                    wait, attempt, MAX_RETRIES, subject,
                )
                time.sleep(wait)
            else:
                logger.error(
                    "Gemini failed after %d attempt(s) for subject=%r: %s",
                    attempt, subject, e,
                )
                raise


# ── Gmail message parsing helpers ─────────────────────────────────────────────

def _decode_body(payload: dict) -> str:
    """
    Recursively extract the plain-text body from a Gmail message payload.
    Handles multi-part MIME messages (text/plain preferred over text/html).
    """
    def _walk(part: dict) -> str:
        mime = part.get("mimeType", "")
        parts = part.get("parts", [])

        if mime == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

        if parts:
            for sub in parts:
                text = _walk(sub)
                if text:
                    return text

        if mime != "text/html" and not parts:
            data = part.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

        return ""

    return _walk(payload)


def _get_header(headers: list[dict], name: str) -> str:
    """Return the first header value matching `name` (case-insensitive)."""
    name_lower = name.lower()
    for h in headers:
        if h.get("name", "").lower() == name_lower:
            return h.get("value", "")
    return ""


def _parse_sender(from_raw: str) -> tuple[str, str]:
    """
    Split a 'From' header like 'Jane Doe <jane@example.com>' into (name, email).
    Falls back to (from_raw, '') if the header is unusual.
    """
    m = re.match(r'^"?([^"<]+)"?\s*(?:<([^>]+)>)?', from_raw.strip())
    if m:
        name  = m.group(1).strip() or from_raw
        email = m.group(2) or ""
        return name, email
    return from_raw, ""


# ── Per-email trace model (used by the /gmail/debug endpoint) ─────────────────

class GmailEmailTrace(BaseModel):
    """Raw per-email trace: Gmail metadata + Gemini output. No DB interaction."""
    id:           str
    subject:      str
    sender_name:  str
    sender_email: str
    sent_at:      str
    body_length:  int
    body_preview: str
    is_ooo:       Optional[bool] = None
    person_name:  Optional[str]  = None
    start_date:   Optional[str]  = None
    end_date:     Optional[str]  = None
    reason:       Optional[str]  = None
    notes:        Optional[str]  = None
    error:        Optional[str]  = None


# ── API response model compatible with apply_timeoff_entries() ────────────────

class GmailTimeOffEntry(BaseModel):
    """
    A single OOO entry extracted from Gmail.
    Field names match TimeOffEntry (slack_parser.py) so that
    crud.apply_timeoff_entries() can consume either type without changes.
    """
    sent_at:           str
    sender:            str
    message:           str            # email subject line used as the "message" text
    person_username:   str            # name matched against team members
    start_date:        Optional[str] = None
    end_date:          Optional[str] = None
    reason:            Optional[str] = None
    coverage_username: Optional[str] = None  # rarely available in email context
    notes:             Optional[str] = None


# ── Main public functions ──────────────────────────────────────────────────────

def fetch_and_parse_gmail(max_results: int = 5) -> list[GmailTimeOffEntry]:
    """
    1. Search Gmail for OOO-related emails (pre-filtered by keyword query).
    2. Fetch each matching email's full content.
    3. Run each through Gemini to confirm OOO and extract dates.
    4. Return OOO entries compatible with crud.apply_timeoff_entries().

    Args:
        max_results: Maximum number of emails to retrieve from the Gmail search
                     (default 10). Because the search pre-filters by OOO keywords,
                     this corresponds to "scan up to 10 OOO-related emails".

    Returns:
        List of GmailTimeOffEntry objects for confirmed OOO emails only.
    """
    logger.debug("Gmail search query: %s", GMAIL_SEARCH_QUERY)
    logger.info(
        "Searching Gmail inbox (user=%s, max_results=%d, lookback=%dd)",
        GMAIL_USER_EMAIL, max_results, _SEARCH_DAYS,
    )

    service = build_gmail_service()

    # ── Diagnostic: log the 5 most recent inbox emails regardless of filter ───
    try:
        diag = service.users().messages().list(
            userId=GMAIL_USER_EMAIL, labelIds=["INBOX"], maxResults=5
        ).execute()
        diag_stubs = diag.get("messages", [])
        logger.info("DIAGNOSTIC — latest %d inbox email(s):", len(diag_stubs))
        for diag_stub in diag_stubs:
            diag_msg = service.users().messages().get(
                userId=GMAIL_USER_EMAIL, id=diag_stub["id"], format="metadata",
                metadataHeaders=["Subject", "From"],
            ).execute()
            diag_headers = diag_msg.get("payload", {}).get("headers", [])
            diag_subject = _get_header(diag_headers, "Subject") or "(no subject)"
            diag_from = _get_header(diag_headers, "From") or "(unknown sender)"
            logger.info("  id=%s from=%r subject=%r", diag_stub["id"], diag_from, diag_subject)
    except Exception as diag_exc:
        logger.warning("DIAGNOSTIC fetch failed: %s", diag_exc)

    # ── Step 1: Search inbox ──────────────────────────────────────────────────
    list_response = service.users().messages().list(
        userId=GMAIL_USER_EMAIL,
        q=GMAIL_SEARCH_QUERY,
        maxResults=max_results,
    ).execute()

    message_stubs = list_response.get("messages", [])
    logger.info("Gmail search returned %d message stub(s)", len(message_stubs))

    if not message_stubs:
        logger.warning(
            "No emails matched the Gmail search query — verify keywords and that the "
            "authenticated account (%s) received the emails within the last %dd",
            GMAIL_USER_EMAIL, _SEARCH_DAYS,
        )
        return []

    entries: list[GmailTimeOffEntry] = []

    # ── Step 2: Fetch + parse each email ─────────────────────────────────────
    for i, stub in enumerate(message_stubs):
        msg = service.users().messages().get(
            userId=GMAIL_USER_EMAIL,
            id=stub["id"],
            format="full",
        ).execute()

        headers     = msg.get("payload", {}).get("headers", [])
        subject     = _get_header(headers, "Subject") or "(no subject)"
        from_raw    = _get_header(headers, "From")

        sender_name, sender_email = _parse_sender(from_raw)

        # Gmail stores internalDate in milliseconds since epoch (UTC)
        internal_ms = int(msg.get("internalDate", 0))
        sent_at     = datetime.fromtimestamp(internal_ms / 1000, tz=timezone.utc)

        logger.debug(
            "[%d/%d] Fetched email id=%s subject=%r sender=%r sent_at=%s",
            i + 1, len(message_stubs), stub["id"], subject, sender_name,
            sent_at.strftime("%Y-%m-%d %H:%M UTC"),
        )

        body = _decode_body(msg.get("payload", {}))

        details = _parse_email_for_ooo(subject, sender_name, sender_email, body, sent_at)

        logger.info(
            "[%d/%d] Gemini → is_ooo=%s person=%r start=%r end=%r  (subject=%r)",
            i + 1, len(message_stubs),
            details.is_ooo, details.person_name, details.start_date, details.end_date,
            subject,
        )

        if details.is_ooo:
            person = details.person_name or sender_name
            entries.append(GmailTimeOffEntry(
                sent_at=sent_at.isoformat(),
                sender=sender_name,
                message=subject,
                person_username=person,
                start_date=details.start_date,
                end_date=details.end_date,
                reason=details.reason,
                notes=details.notes,
            ))

        # Respect Gemini free-tier rate limit (15 RPM) — skip delay after last email
        if i < len(message_stubs) - 1:
            time.sleep(INTER_CALL_DELAY_SECONDS)

    logger.info(
        "fetch_and_parse_gmail complete: scanned=%d ooo_detected=%d",
        len(message_stubs), len(entries),
    )
    return entries


def fetch_and_parse_gmail_debug(
    max_results: int = 20,
) -> tuple[str, int, int, list[GmailEmailTrace]]:
    """
    Dry-run version of fetch_and_parse_gmail.
    Searches Gmail and runs Gemini classification but does NOT filter to OOO-only.
    Returns (search_query, search_days, emails_found, traces) where each trace
    contains the full Gemini output (or an error string) for every email retrieved.
    No database writes are performed.
    """
    logger.info(
        "DEBUG Gmail scan (no DB writes): user=%s max_results=%d lookback=%dd",
        GMAIL_USER_EMAIL, max_results, _SEARCH_DAYS,
    )

    service = build_gmail_service()

    list_response = service.users().messages().list(
        userId=GMAIL_USER_EMAIL,
        q=GMAIL_SEARCH_QUERY,
        maxResults=max_results,
    ).execute()

    message_stubs = list_response.get("messages", [])
    found = len(message_stubs)
    logger.info("DEBUG Gmail search returned %d message stub(s)", found)

    traces: list[GmailEmailTrace] = []

    for i, stub in enumerate(message_stubs):
        msg = service.users().messages().get(
            userId=GMAIL_USER_EMAIL,
            id=stub["id"],
            format="full",
        ).execute()

        headers     = msg.get("payload", {}).get("headers", [])
        subject     = _get_header(headers, "Subject") or "(no subject)"
        from_raw    = _get_header(headers, "From")
        sender_name, sender_email = _parse_sender(from_raw)

        internal_ms = int(msg.get("internalDate", 0))
        sent_at     = datetime.fromtimestamp(internal_ms / 1000, tz=timezone.utc)

        body         = _decode_body(msg.get("payload", {}))
        body_preview = body[:300].strip()

        error_str: str | None = None
        details: EmailOOODetails | None = None
        try:
            details = _parse_email_for_ooo(subject, sender_name, sender_email, body, sent_at)
        except Exception as exc:
            error_str = str(exc)
            logger.warning("DEBUG Gemini error for id=%s subject=%r: %s", stub["id"], subject, exc)

        traces.append(GmailEmailTrace(
            id=stub["id"],
            subject=subject,
            sender_name=sender_name,
            sender_email=sender_email,
            sent_at=sent_at.isoformat(),
            body_length=len(body),
            body_preview=body_preview,
            is_ooo=details.is_ooo if details else None,
            person_name=details.person_name if details else None,
            start_date=details.start_date if details else None,
            end_date=details.end_date if details else None,
            reason=details.reason if details else None,
            notes=details.notes if details else None,
            error=error_str,
        ))

        if i < len(message_stubs) - 1:
            time.sleep(INTER_CALL_DELAY_SECONDS)

    logger.info("DEBUG fetch_and_parse_gmail_debug complete: scanned=%d", found)
    return GMAIL_SEARCH_QUERY, _SEARCH_DAYS, found, traces

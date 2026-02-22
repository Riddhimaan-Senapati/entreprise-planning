# CoverageIQ — Backend

FastAPI + SQLite backend for the CoverageIQ team coverage intelligence app.

Reads ICS calendars, parses Slack time-off messages with Google Gemini, scores
task–member suggestions with AI, and exposes a REST API consumed by the Next.js
frontend.

---

## Project structure

```
backend/
├── main.py                  # FastAPI app — routes, CORS, lifespan DB init
├── database.py              # SQLModel engine + get_session dependency
├── models.py                # DB tables (TeamMember, Task, Suggestion …) + response schemas
├── crud.py                  # Database read/write helpers
├── seed.py                  # One-time DB seeder — reads from data/
├── data/
│   ├── members.json         # 24 team members (source of truth)
│   └── tasks.json           # 6 at-risk tasks with suggestions
├── routers/
│   ├── members.py           # /members endpoints
│   ├── tasks.py             # /tasks endpoints
│   └── calendar.py          # /calendar endpoints (ICS upload)
├── calendar_availability.py # ICS parsing + per-day availability calculation
├── slack_parser.py          # Gemini-powered Slack time-off parser
├── score_skills.py          # Batch skill-match scorer (offline, writes skill_scores.json)
├── data_loader.py           # Shared data utilities (ICS map, week helpers)
├── dummy_maya_calendar.ics  # Sample ICS file for Maya Patel
├── requirements.txt
├── .env.example             # Template — copy to .env and fill in credentials
└── .env                     # Your local credentials (never committed)
```

---

## Prerequisites

### Python
Python 3.11+ recommended.

### Slack app scopes
Your bot needs these token scopes:

| Scope | Purpose |
|---|---|
| `channels:history` | Read time-off messages |
| `channels:read` | Get channel metadata |
| `users:read` | Resolve `<@UID>` mentions to names |
| `im:write` | Open DM channels for availability pings |
| `chat:write` | Send availability-check DMs |

> For **private channels** also add `groups:history` and `groups:read`.

### Google Gemini API key
Free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

---

## Setup

```bash
# 1. Create and activate a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure credentials
cp .env.example .env
# Edit .env and fill in SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, GEMINI_API_KEY
```

### `.env` file

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Bot token (`xoxb-…`) |
| `SLACK_CHANNEL_ID` | Yes | Channel to scan for time-off announcements |
| `GEMINI_API_KEY` | Yes | Google Gemini key for AI parsing |
| `SLACK_PING_USER_ID` | No | Slack member ID to receive DM pings (leave blank to disable) |
| `DATABASE_URL` | No | SQLite path — defaults to `coverageiq.db` |

---

## Running

```bash
# Start the API server (auto-seeds the DB on first boot)
python -m uvicorn main:app --reload --port 8000
```

On first start the server will:
1. Create `coverageiq.db` and all tables
2. Seed 24 members + 6 tasks from `data/members.json` and `data/tasks.json`
3. Run a live ICS parse for Maya Patel (`dummy_maya_calendar.ics`) and update her availability
4. Run `tick_slack_ooo_status` to activate any pending Slack OOOs and restore expired ones

Subsequent starts skip seeding automatically but always run the OOO tick.

Interactive API docs: **http://localhost:8000/docs**

---

## API reference

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check → `{"status": "ok"}` |

### Summary

| Method | Path | Description |
|---|---|---|
| `GET` | `/summary` | Team counts: OOO, available, critical tasks |

```json
{
  "ooo": 5,
  "fullyAvailable": 19,
  "criticalAtRisk": 4,
  "unresolvedReassignments": 6,
  "lastSynced": "2026-02-21T19:41:55Z"
}
```

### Members

| Method | Path | Description |
|---|---|---|
| `GET` | `/members` | All 24 team members with availability signals. Ticks Slack OOO status before returning. |
| `GET` | `/members/{id}` | Single member by ID (e.g. `mem-012`) |
| `PATCH` | `/members/{id}/override` | Manually set leave status (`available` \| `ooo`) |
| `DELETE` | `/members/{id}/override` | Clear a manual override, restoring the member to `available` |
| `PATCH` | `/members/{id}/notes` | Save manager notes for a member |
| `PATCH` | `/members/{id}/skills` | Update the skills list for a member |
| `GET` | `/members/{id}/availability` | Live ICS availability report (no DB write) |
| `POST` | `/members/{id}/calendar/sync` | Re-run ICS calc and persist to DB |

**Override body:**
```json
{ "leaveStatus": "ooo" }
```

**Notes body:**
```json
{ "notes": "Back from parental leave in March." }
```

**Skills body:**
```json
{ "skills": ["React", "TypeScript", "Node.js"] }
```

### Tasks

| Method | Path | Description |
|---|---|---|
| `POST` | `/tasks` | Create a new task |
| `GET` | `/tasks` | All tasks (optional `?status=at-risk`) |
| `GET` | `/tasks/{id}` | Single task with ranked suggestions |
| `PATCH` | `/tasks/{id}/status` | Update status (`at-risk` \| `covered` \| `unassigned`) |
| `PATCH` | `/tasks/{id}/reassign` | Assign a new member and mark covered |
| `PATCH` | `/tasks/{id}/unassign` | Remove assignee and reset to `unassigned` |
| `DELETE` | `/tasks/{id}` | Delete a task and all its suggestions |

**Create task body:**
```json
{
  "title": "Fix auth regression",
  "priority": "P0",
  "projectName": "Core Platform",
  "deadline": "2026-02-28T17:00:00Z",
  "assigneeId": null
}
```
`assigneeId: null` → task is `unassigned` and the skill pipeline will find candidates.
`assigneeId: "mem-007"` → task is immediately `covered`.

### Slack

| Method | Path | Description |
|---|---|---|
| `GET` | `/timeoff` | Raw Gemini-parsed time-off entries from Slack (`?hours=24&limit=100`) |
| `POST` | `/timeoff/sync` | Scan Slack, apply OOO statuses to matched team members (`?hours=24&limit=100`) |
| `POST` | `/ping` | Send an availability-check DM to a team member |

#### `POST /timeoff/sync` — Slack availability sync

Fetches recent Slack messages, runs each through Gemini AI to detect time-off
announcements, fuzzy-matches each person to a team member by name, and updates
their `leave_status` in the database.

**Future OOO support** — if a message says "OOO next week", the start date is
stored and the member's status stays `available` until that date arrives.
`GET /members` automatically activates pending OOOs without any further action.

Returns:
```json
{
  "detected": 3,
  "applied": 2,
  "pending": 1,
  "skipped": 1,
  "changes": [
    {
      "memberId": "mem-007",
      "memberName": "Jordan Kim",
      "personUsername": "jordan.kim",
      "startDate": "3/3/2026",
      "endDate": "3/7/2026",
      "reason": "vacation",
      "coverageBy": "Alex Chen",
      "pending": true
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `detected` | Slack messages Gemini classified as time-off |
| `applied` | Entries matched to a known team member (includes pending) |
| `pending` | Applied entries whose start date is still in the future |
| `skipped` | Detected but no member match, already expired, or manually overridden |

**Matching** — names are fuzzy-matched using `difflib.SequenceMatcher` (threshold 0.75).
Slack display names like `"jordan.lee"` or just `"Jordan"` will match `"Jordan Lee"`.
Members with a manual override (`manually_overridden = true`) are never modified.

---

## Database

The app uses SQLite (`coverageiq.db`). To reset and reseed from scratch:

```bash
rm coverageiq.db
python -m uvicorn main:app --reload --port 8000
# or seed manually without starting the server:
python seed.py
```

The seed data lives in `data/members.json` and `data/tasks.json` — edit those files
to change the default dataset, then reseed.

### Schema changes
SQLite does not support `ALTER COLUMN`. After any change to table models in `models.py`,
delete `coverageiq.db` and reseed.

---

## Offline utilities

### Slack time-off fetch (CLI)
Run the Slack parser directly without the server:

```bash
python fetch_timeoff.py              # last 24 h
python fetch_timeoff.py --hours 168  # last 7 days
```

### Skill-match scorer
Batch-scores all task–member suggestion pairs using Gemini and writes `skill_scores.json`:

```bash
python score_skills.py           # score all pairs (~18 Gemini calls)
python score_skills.py --dry-run # parse only, no API calls
```

The scorer is resumable — interrupt it at any point and re-run to continue from where it left off.

### ICS availability (standalone)
```bash
python calendar_availability.py dummy_maya_calendar.ics
```

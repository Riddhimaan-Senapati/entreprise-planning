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
│   └── tasks.py             # /tasks endpoints
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
| `SLACK_CHANNEL_ID` | Yes | Channel to read time-off messages from |
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

Subsequent starts skip seeding automatically.

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
| `GET` | `/summary` | Team counts: OOO, partial, available, critical tasks |

```json
{
  "ooo": 5,
  "partial": 3,
  "fullyAvailable": 16,
  "criticalAtRisk": 4,
  "unresolvedReassignments": 6,
  "lastSynced": "2026-02-21T19:41:55Z"
}
```

### Members

| Method | Path | Description |
|---|---|---|
| `GET` | `/members` | All 24 team members with availability signals |
| `GET` | `/members/{id}` | Single member by ID (e.g. `mem-012`) |
| `PATCH` | `/members/{id}/override` | Manually set leave status (`available` / `partial` / `ooo`) |
| `GET` | `/members/{id}/availability` | Live ICS availability report (no DB write) |
| `POST` | `/members/{id}/calendar/sync` | Re-run ICS calc and persist to DB |

**Override body:**
```json
{ "leaveStatus": "ooo" }
```

### Tasks

| Method | Path | Description |
|---|---|---|
| `GET` | `/tasks` | All tasks (optional `?status=at-risk`) |
| `GET` | `/tasks/{id}` | Single task with ranked suggestions |
| `PATCH` | `/tasks/{id}/status` | Update status (`at-risk` / `covered` / `unassigned`) |

**Status update body:**
```json
{ "status": "covered" }
```

### Slack

| Method | Path | Description |
|---|---|---|
| `GET` | `/timeoff` | Gemini-parsed time-off entries from Slack (`?hours=24&limit=100`) |
| `POST` | `/ping` | Send an availability-check DM to a team member |

---

## Database

The app uses SQLite (`coverageiq.db`). To reset and reseed from scratch:

```bash
# Delete the database file and restart the server
rm coverageiq.db
python -m uvicorn main:app --reload --port 8000
```

The seed data lives in `data/members.json` and `data/tasks.json` — edit those files
to change the default dataset, then reseed.

---

## Offline utilities

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

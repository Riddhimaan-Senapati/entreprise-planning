# CoverageIQ — Enterprise Planning

AI-powered team coverage intelligence. See who's out, which tasks are at risk,
and get Gemini-ranked reassignment suggestions — all in one dashboard.

---

## Monorepo layout

```
entreprise-planning/
├── backend/        # FastAPI + SQLite API server
└── coverageiq/     # Next.js 15 frontend
```

---

## Quick start

### 1. Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up credentials
cp .env.example .env
# Edit .env — fill in SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, GEMINI_API_KEY

# Start the server (auto-creates and seeds the database on first run)
python -m uvicorn main:app --reload --port 8000
```

API + interactive docs → **http://localhost:8000/docs**

### 2. Frontend

```bash
cd coverageiq

npm install
npm run dev
```

App → **http://localhost:3000**

---

## Required credentials

| Variable | Where to get it |
|---|---|
| `SLACK_BOT_TOKEN` | Slack app → OAuth & Permissions → Bot token (`xoxb-…`) |
| `SLACK_CHANNEL_ID` | Right-click channel in Slack → View channel details → bottom of About |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free) |

See `backend/.env.example` for the full list including optional variables.

---

## Further reading

- [`backend/README.md`](backend/README.md) — API reference, database, offline tools
- [`coverageiq/README.md`](coverageiq/README.md) — Frontend pages, data flow, project structure

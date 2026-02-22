# Vantage

**AI-powered team coverage intelligence for enterprise project managers.**

Vantage gives you a real-time view of who's out, which tasks are at risk, and who should take them over — surfaced automatically from Slack, Gmail, and calendar data, ranked by Google Gemini.

---

## Features

- **Live availability tracking** — syncs out-of-office status from Slack messages, Gmail OOO replies, and `.ics` calendar files
- **At-risk task detection** — automatically flags tasks assigned to unavailable team members
- **AI reassignment suggestions** — Gemini ranks candidates by skill match, workload, and context
- **Manual overrides** — managers can override any status; overrides always take priority
- **Auth** — Clerk-based login with a single hardcoded admin account

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind CSS 4, shadcn/ui, Zustand |
| Backend | FastAPI, SQLModel, SQLite / PostgreSQL |
| AI | Google Gemini (pydantic-ai) |
| Auth | Clerk |
| Integrations | Slack SDK, Gmail API, iCalendar |
| Deployment | DigitalOcean App Platform |

---

## Monorepo layout

```
entreprise-planning/
├── backend/        # FastAPI REST API
└── coverageiq/     # Next.js frontend
```

---

## Getting started

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env           # fill in SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, GEMINI_API_KEY
python -m uvicorn main:app --reload --port 8000
```

Swagger UI → `http://localhost:8000/docs`

### Frontend

```bash
cd coverageiq
npm install
npm run dev
```

App → `http://localhost:3000`

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Slack app bot token (`xoxb-…`) |
| `SLACK_CHANNEL_ID` | Channel ID to scan for OOO messages |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) — free tier works |
| `DATABASE_URL` | PostgreSQL URL for production (SQLite used locally) |

### Frontend (`coverageiq/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_API_URL` | Backend base URL (default: `http://localhost:8000`) |

See `credentials.js` in the frontend for the hardcoded admin account. Create that user in your [Clerk dashboard](https://dashboard.clerk.com) before first login.

---

## Auth flow

Unauthenticated visits are redirected to `/sign-in`. On successful login, the Vantage loading screen plays before the dashboard appears.

---

## License

MIT

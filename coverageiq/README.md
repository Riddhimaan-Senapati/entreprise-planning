# CoverageIQ — Frontend

Next.js 15 frontend for the CoverageIQ team coverage intelligence app.

Shows real-time team availability, flags at-risk tasks, and surfaces AI-ranked
reassignment suggestions — all driven by the FastAPI backend.

> **The backend must be running** before you open the app. See setup below.

---

## Prerequisites

- Node.js 18+
- The backend running on `http://localhost:8000` (see `../backend/README.md`)

---

## Setup

```bash
# Install dependencies
npm install

# (Optional) configure the backend URL
# Only needed if the backend runs on a different port or host
cp .env.local.example .env.local
# Edit NEXT_PUBLIC_API_URL if required (defaults to http://localhost:8000)
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Base URL of the FastAPI backend |

No `.env.local` is required if the backend is on `localhost:8000`.

---

## Running

```bash
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## Pages

| Route | Description |
|---|---|
| `/overview` | Today's team snapshot — summary stats, at-risk task chips, member grid |
| `/task-command` | Triage at-risk tasks — select a task to see AI-ranked coverage suggestions |
| `/week-ahead` | Per-member day-by-day availability heat map + headcount chart |
| `/team` | Team directory (coming soon) |

---

## Project structure

```
coverageiq/
├── app/
│   ├── layout.tsx               # Root layout — fonts, sidebar, toast provider
│   ├── overview/page.tsx        # Overview page
│   ├── task-command/
│   │   ├── page.tsx             # Server wrapper with Suspense
│   │   └── TaskCommandClient.tsx
│   ├── week-ahead/page.tsx      # Week-ahead page
│   └── team/page.tsx            # Placeholder
├── components/dashboard/
│   ├── SummaryBar.tsx           # OOO / partial / available / risk counts
│   ├── RiskChipStrip.tsx        # At-risk task chips
│   ├── TeamGrid.tsx             # Member card grid with filters
│   ├── TaskList.tsx             # Prioritised task list with filter pills
│   ├── SuggestionPanel.tsx      # AI suggestion cards + action buttons
│   ├── WeekChart.tsx            # Available headcount area chart
│   ├── PersonCard.tsx           # Individual member card with confidence ring
│   ├── ConfidenceRing.tsx       # Animated SVG confidence ring
│   └── Sidebar.tsx              # Navigation + sync status
├── hooks/use-api.ts             # useFetch, useTeamMembers, useTasks, useSummary …
├── lib/
│   ├── api-client.ts            # Typed fetch wrappers for all backend endpoints
│   ├── types.ts                 # Shared TypeScript interfaces
│   └── utils.ts                 # cn, colour helpers, SVG ring math
└── store/index.ts               # Zustand store — selected task, filters, overrides
```

---

## Data flow

All data comes from the FastAPI backend — there is no local mock data.

```
Backend (FastAPI :8000)
  └── GET /members   →  useTeamMembers()  →  TeamGrid, WeekAheadPage, SuggestionPanel
  └── GET /tasks     →  useTasks()        →  TaskList, RiskChipStrip, SuggestionPanel
  └── GET /summary   →  useSummary()      →  SummaryBar, Sidebar, StaleBanner
  └── PATCH /members/{id}/override        →  useMemberOverride() (PersonCard menu)
  └── PATCH /tasks/{id}/status            →  useTaskStatusUpdate() (Reassign button)
  └── POST  /members/{id}/calendar/sync   →  useCalendarSync()
  └── POST  /ping                         →  sendAvailabilityPing() (Check availability button)
```

---

## Building for production

```bash
npm run build
npm start
```

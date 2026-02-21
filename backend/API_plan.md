# CoverageIQ — API Implementation Plan

This document maps every frontend data dependency and user interaction in `coverageiq/` to the
backend API endpoints that need to exist. A future agent can use this as a complete blueprint to
implement all the APIs without guessing at the data shapes or the frontend wiring.

---

## 1. Architecture overview

```
Browser (Next.js 15 App Router)
  └─ Server Components: fetch from FastAPI on the server during SSR
  └─ Client Components: call FastAPI directly (or via SWR/React Query)

FastAPI backend  (backend/main.py)
  ├─ Already exists: GET /health, GET /timeoff, POST /ping
  └─ To be added: /api/tasks, /api/members, /api/sync, /api/tasks/{id}/..., /api/members/{id}/...

Data files (read at startup / on request)
  ├─ coverageiq/lib/mock-data.ts  → parsed and served by the backend
  └─ backend/skill_scores.json    → merged into task suggestions
```

**Frontend import replacement strategy**: Every `import { x } from '@/lib/mock-data'` in the
frontend needs to become an API fetch. Server components use `fetch()` at build/request time;
client components that need reactivity use SWR.

**CORS**: The existing `CORSMiddleware` already allows `*` origins, so no changes needed there.

---

## 2. Existing endpoints (do not change)

| Method | Path | Status |
|--------|------|--------|
| `GET` | `/health` | Done — liveness check |
| `GET` | `/timeoff` | Done — Slack time-off parse |
| `POST` | `/ping` | Done — Slack DM availability check |

The `POST /ping` endpoint is fully implemented. The frontend's **"Check availability"** button
(`SuggestionPanel.tsx:handleAskFirst`) currently only calls `setPingSent` in Zustand without
calling the API. That wiring needs to be added (see §8).

---

## 3. Shared data models (Python Pydantic → JSON)

These types define the exact JSON schemas the frontend expects. They mirror `coverageiq/lib/types.ts`.

### 3.1 `Suggestion`
```python
class Suggestion(BaseModel):
    memberId:     str
    skillMatchPct: int          # 0–100
    workloadPct:  int           # 0–100
    contextReason: str
```

### 3.2 `Task`
```python
class Task(BaseModel):
    id:          str
    title:       str
    priority:    Literal['P0', 'P1', 'P2']
    assigneeId:  str
    deadline:    str            # ISO 8601, e.g. "2026-02-22T17:00:00Z"
    projectName: str
    status:      Literal['at-risk', 'unassigned', 'covered']
    suggestions: list[Suggestion]
```

### 3.3 `DataSourceSignal`
```python
class DataSourceSignal(BaseModel):
    calendarPct:   int          # 0–100
    taskLoadHours: float        # hours
    leaveStatus:   Literal['available', 'partial', 'ooo']
```

### 3.4 `WeekAvailability`
```python
class WeekAvailability(BaseModel):
    monday:    int              # 0–100
    tuesday:   int
    wednesday: int
    thursday:  int
    friday:    int
```

### 3.5 `TeamMember`
```python
class TeamMember(BaseModel):
    id:              str
    name:            str
    role:            str
    team:            Literal['Engineering', 'Design', 'Product']
    confidenceScore: int        # 0–100
    skills:          list[str]
    dataSources:     DataSourceSignal
    currentTasks:    list[Task]  # tasks currently assigned to this member
    isOOO:           bool
    lastSynced:      str        # ISO 8601
    weekAvailability: WeekAvailability
```

### 3.6 `WeekChartPoint`
```python
class WeekChartPoint(BaseModel):
    day:       str              # "Mon", "Tue", etc.
    available: int              # headcount available that day
```

---

## 4. `GET /api/tasks`

### Purpose
Returns all at-risk tasks, with suggestions merged with AI-scored `skillMatchPct` from
`backend/skill_scores.json`. Replaces the `atRiskTasks` import in:
- `coverageiq/components/dashboard/SummaryBar.tsx` (lines 3, 38–39)
- `coverageiq/components/dashboard/RiskChipStrip.tsx` (lines 4, 31)
- `coverageiq/components/dashboard/TaskList.tsx` (lines 5–6, 49)
- `coverageiq/components/dashboard/SuggestionPanel.tsx` (lines 7, 184)

### Request
```
GET /api/tasks
```
No parameters.

### Response
```json
[
  {
    "id": "task-001",
    "title": "Auth service migration to OAuth 2.0",
    "priority": "P0",
    "assigneeId": "mem-003",
    "deadline": "2026-02-22T17:00:00Z",
    "projectName": "Platform / Core Auth",
    "status": "at-risk",
    "suggestions": [
      {
        "memberId": "mem-007",
        "skillMatchPct": 90,
        "workloadPct": 29,
        "contextReason": "Jordan's direct OAuth and Node.js expertise..."
      }
    ]
  }
]
```

### Implementation notes
1. Parse `coverageiq/lib/mock-data.ts` using the existing `parse_mock_data()` in `score_skills.py`
   (extract `parse_mock_data` to a shared `data_loader.py` module so both scripts and the server
   can call it).
2. Load `backend/skill_scores.json`. For each task→suggestion pair, if a scored entry exists,
   replace `suggestion.skillMatchPct` with the value from `skill_scores.json` and update
   `contextReason` with the AI reasoning. Fall back to mock data values if the pair is not scored.
3. Task `deadline` in mock-data.ts is a relative `new Date(now + Xh)`. At parse time, convert to
   an absolute ISO 8601 string using the current wall-clock time. Store the offset in hours so the
   server can reconstruct the absolute deadline on each cold start (or cache the result).
4. Apply any in-memory task status overrides (see §7 — `PATCH /api/tasks/{taskId}/status`).
5. Response model: `list[Task]`.

### Frontend wiring
Replace direct imports with a `fetch('/api/tasks')` call. Pages that are Server Components
(`overview/page.tsx`, `week-ahead/page.tsx`) can call this in the component body. The Task Command
page uses a client component (`TaskCommandClient.tsx`) so it should use SWR:
```ts
const { data: tasks } = useSWR<Task[]>('/api/tasks', fetcher)
```

---

## 5. `GET /api/members`

### Purpose
Returns all team members with full profiles. Replaces the `teamMembers` import in:
- `coverageiq/components/dashboard/SummaryBar.tsx` (lines 3, 31–38)
- `coverageiq/components/dashboard/TaskList.tsx` (line 6, 92)
- `coverageiq/components/dashboard/SuggestionPanel.tsx` (lines 7, 23)
- `coverageiq/components/dashboard/TeamGrid.tsx`
- `coverageiq/app/week-ahead/page.tsx` (line 3, 58)

### Request
```
GET /api/members
```
No parameters.

### Response
```json
[
  {
    "id": "mem-007",
    "name": "Jordan Lee",
    "role": "Senior Backend Engineer",
    "team": "Engineering",
    "confidenceScore": 85,
    "skills": ["OAuth 2.0", "Node.js", "TypeScript"],
    "dataSources": {
      "calendarPct": 71,
      "taskLoadHours": 18,
      "leaveStatus": "available"
    },
    "currentTasks": [],
    "isOOO": false,
    "lastSynced": "2026-02-21T14:00:00Z",
    "weekAvailability": {
      "monday": 80, "tuesday": 60, "wednesday": 75, "thursday": 90, "friday": 70
    }
  }
]
```

### Implementation notes
1. Parse `teamMembers` from mock-data.ts via `parse_mock_data()`.
2. Apply any in-memory member override records (see §8 — `PATCH /api/members/{memberId}/override`).
   Overridden members should have their `dataSources.leaveStatus` and `isOOO` fields updated to
   reflect the override so clients don't need to apply it themselves.
3. `currentTasks` for each member: filter `atRiskTasks` where `task.assigneeId === member.id`.
4. `lastSynced`: derive from the module-level `lastSynced` variable in mock-data.ts (currently
   `threeHoursAgo`). Parse it as an ISO string.
5. Response model: `list[TeamMember]`.

### Frontend wiring
Server Components can fetch directly; client components use SWR. `PersonCard` (client, inside
`TeamGrid`) needs the member data passed as a prop from the parent, which fetches via SWR.

---

## 6. `GET /api/sync`

### Purpose
Returns the last-synced timestamp and weekly headcount chart data. Replaces:
- `lastSynced` import in `coverageiq/app/overview/page.tsx` (line 6)
- `weekChartData` import in `coverageiq/components/dashboard/WeekChart.tsx` (line 12)

### Request
```
GET /api/sync
```

### Response
```json
{
  "lastSynced": "2026-02-21T11:00:00Z",
  "weekChartData": [
    { "day": "Mon", "available": 18 },
    { "day": "Tue", "available": 21 },
    { "day": "Wed", "available": 16 },
    { "day": "Thu", "available": 20 },
    { "day": "Fri", "available": 14 }
  ]
}
```

### Implementation notes
1. `lastSynced`: parse from the `const threeHoursAgo = new Date(now - 3h)` in mock-data.ts.
   A simpler approach: return `datetime.utcnow() - timedelta(hours=3)` at startup and update it
   when a real Slack sync happens (see `/api/sync/trigger` in future work).
2. `weekChartData`: parse the `weekChartData` export from mock-data.ts. The format is already
   `[{ day: string, available: number }]`.
3. The stale-data banner in `overview/page.tsx` shows if `Date.now() - lastSynced > 2 hours`.
   Once the real Slack sync (`GET /timeoff`) is used to populate member OOO status, this endpoint
   should return the timestamp of the most recent successful Slack fetch.
4. Response model: `class SyncStatus(BaseModel): lastSynced: str; weekChartData: list[WeekChartPoint]`

---

## 7. `PATCH /api/tasks/{taskId}/status`

### Purpose
Persists a task status change (covered, at-risk, unassigned) on the server so it survives
page refreshes. Currently done only in Zustand (`taskStatusOverrides`) which is reset on refresh.
Called by `SuggestionPanel.tsx:handleReassign` (line 34).

### Request
```
PATCH /api/tasks/task-001/status
Content-Type: application/json

{ "status": "covered" }
```

### Response
```json
{ "taskId": "task-001", "status": "covered" }
```

### Implementation notes
1. Keep an in-memory dict `task_status_overrides: dict[str, str]` in `main.py` (module level).
   This is enough for a single-server dev setup; swap for Redis/DB in production.
2. `GET /api/tasks` reads this dict and overrides `task.status` before returning.
3. Validate `taskId` against the parsed task list; return 404 if not found.
4. Validate `status` is one of `['at-risk', 'unassigned', 'covered']`.
5. Pydantic model: `class TaskStatusUpdate(BaseModel): status: Literal['at-risk', 'unassigned', 'covered']`

### Frontend wiring
`SuggestionPanel.tsx` — `handleReassign` function (line 33–38):
```ts
// Current (Zustand only):
setTaskStatus(taskId, 'covered')

// After wiring:
await fetch(`${BACKEND}/api/tasks/${taskId}/status`, {
  method: 'PATCH',
  body: JSON.stringify({ status: 'covered' }),
  headers: { 'Content-Type': 'application/json' },
})
setTaskStatus(taskId, 'covered')  // optimistic update
```

---

## 8. `POST /api/tasks/{taskId}/schedule`

### Purpose
Marks a task as "deferred to tomorrow" server-side. Currently Zustand-only
(`scheduledTasks` in `store/index.ts`). Called by `SuggestionPanel.tsx:handleSchedule` (line 51).

### Request
```
POST /api/tasks/task-001/schedule
```
No request body needed.

### Response
```json
{ "taskId": "task-001", "scheduled": true }
```

### Implementation notes
1. In-memory dict `scheduled_tasks: dict[str, bool]` in `main.py`.
2. `GET /api/tasks` adds a `scheduled: bool` field to the Task model and sets it from this dict.
   The frontend uses `scheduledTasks[task.id]` to dim/clock-icon a task, so add `scheduled` to
   the `Task` model (optional bool, default `false`).
3. Validate `taskId` against known tasks; 404 if not found.

### Frontend wiring
`SuggestionPanel.tsx` — `handleSchedule` function (line 51–57):
```ts
await fetch(`${BACKEND}/api/tasks/${taskId}/schedule`, { method: 'POST' })
setScheduled(taskId)  // optimistic
```

---

## 9. `PATCH /api/members/{memberId}/override`

### Purpose
Persists a manual availability override (available / partial / ooo) for a team member.
Currently Zustand-only (`overrides` in `store/index.ts`). Called by `PersonCard.tsx`
dropdown menu items (lines 193–209: "Mark as Available", "Mark as Partially Available",
"Mark as OOO").

### Request
```
PATCH /api/members/mem-007/override
Content-Type: application/json

{ "status": "ooo" }
```

### Response
```json
{ "memberId": "mem-007", "status": "ooo" }
```

### Implementation notes
1. In-memory dict `member_overrides: dict[str, str]` in `main.py`.
2. `GET /api/members` applies overrides: when a member has an override, update
   `member.dataSources.leaveStatus` and `member.isOOO` accordingly before returning.
3. Validate `memberId` against known members; 404 if not found.
4. Validate `status` is one of `['available', 'partial', 'ooo']`.
5. Pydantic model: `class MemberOverride(BaseModel): status: Literal['available', 'partial', 'ooo']`

### Frontend wiring
`PersonCard.tsx` — `setOverride` calls (lines 193, 200, 207):
```ts
// Current:
onClick={() => setOverride(member.id, 'available')}

// After wiring:
onClick={async () => {
  await fetch(`${BACKEND}/api/members/${member.id}/override`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'available' }),
    headers: { 'Content-Type': 'application/json' },
  })
  setOverride(member.id, 'available')  // optimistic local update
}}
```

---

## 10. `DELETE /api/members/{memberId}/override`

### Purpose
Clears a manual availability override. Currently Zustand-only (`clearOverride`).
Called by `PersonCard.tsx` "Clear override" menu item (line 213).

### Request
```
DELETE /api/members/mem-007/override
```

### Response
```json
{ "memberId": "mem-007", "cleared": true }
```

### Implementation notes
1. Remove `memberId` from `member_overrides` dict. If not present, still return 200.
2. `GET /api/members` then returns the raw dataSources/isOOO from mock-data for this member.

### Frontend wiring
`PersonCard.tsx` — `clearOverride` call (line 213):
```ts
onClick={async () => {
  await fetch(`${BACKEND}/api/members/${member.id}/override`, { method: 'DELETE' })
  clearOverride(member.id)
}}
```

---

## 11. `POST /ping` wiring (already exists, needs frontend call)

The `POST /ping` endpoint is already fully implemented in `backend/main.py` (lines 132–245).
The frontend's **"Check availability"** button in `SuggestionPanel.tsx:handleAskFirst`
(lines 43–49) currently only fires a Zustand state update and a toast — it does not call the API.

### What `POST /ping` expects
```json
{
  "member_name":    "Jordan Lee",
  "task_title":     "Auth service migration to OAuth 2.0",
  "project_name":   "Platform / Core Auth",
  "priority":       "P0",
  "deadline":       "2026-02-22T17:00:00Z",
  "context_reason": "Jordan's direct OAuth and Node.js expertise..."
}
```

### Frontend wiring
`SuggestionPanel.tsx` — `handleAskFirst` function (lines 43–49):
```ts
const handleAskFirst = async () => {
  try {
    await fetch(`${BACKEND}/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        member_name:    member.name,
        task_title:     task.title,
        project_name:   task.projectName,
        priority:       task.priority,
        deadline:       task.deadline,         // ISO string from /api/tasks
        context_reason: suggestion.contextReason,
      }),
    })
  } catch (err) {
    console.error('Ping failed:', err)
  }
  setPingSent(taskId, member.id)
  toast.info(`Availability check sent to ${member.name}`, { ... })
}
```

Also call `PATCH /api/tasks/{taskId}/status` body `{ "status": "unassigned" }` if needed after
a successful ping (optional, depends on your workflow).

---

## 12. Data loading module (`data_loader.py`)

### Purpose
Currently `parse_mock_data()` only exists in `score_skills.py`. The server (`main.py`) needs the
same parsing logic. Extract it to a shared file.

### File: `backend/data_loader.py`
```python
"""
Shared data loading utilities.
Parses coverageiq/lib/mock-data.ts and merges with skill_scores.json.
"""
from pathlib import Path
import json
from datetime import datetime, timezone

REPO_ROOT = Path(__file__).parent.parent
MOCK_DATA_PATH = REPO_ROOT / "coverageiq" / "lib" / "mock-data.ts"
SKILL_SCORES_PATH = Path(__file__).parent / "skill_scores.json"

def load_tasks() -> list[dict]:
    """Parse atRiskTasks and merge with AI skill scores."""
    tasks, _ = parse_mock_data(MOCK_DATA_PATH)
    scores = json.loads(SKILL_SCORES_PATH.read_text()) if SKILL_SCORES_PATH.exists() else {}
    for task in tasks:
        task_scores = scores.get(task["id"], {})
        for s in task["suggestions"]:
            scored = task_scores.get(s["memberId"])
            if scored:
                s["skillMatchPct"] = scored["skillMatchPct"]
                s["contextReason"] = scored["contextReason"]
    return tasks

def load_members() -> list[dict]:
    """Parse teamMembers."""
    _, members = parse_mock_data(MOCK_DATA_PATH)
    return list(members.values())
```

Move `_str_field`, `_list_field`, `_split_objects`, `parse_mock_data` from `score_skills.py`
into `data_loader.py`. Update `score_skills.py` to import from `data_loader`.

---

## 13. Summary table

| Method | Path | Frontend component(s) | Mock data replaced | Priority |
|--------|------|-----------------------|--------------------|----------|
| `GET` | `/api/tasks` | `SummaryBar`, `RiskChipStrip`, `TaskList`, `SuggestionPanel` | `atRiskTasks` | **P0** |
| `GET` | `/api/members` | `SummaryBar`, `TeamGrid`, `WeekAheadPage`, `TaskList`, `SuggestionPanel` | `teamMembers` | **P0** |
| `GET` | `/api/sync` | `OverviewPage` (stale banner), `WeekChart` | `lastSynced`, `weekChartData` | **P1** |
| `PATCH` | `/api/tasks/{id}/status` | `SuggestionPanel` → Reassign button | Zustand `taskStatusOverrides` | **P1** |
| `POST` | `/api/tasks/{id}/schedule` | `SuggestionPanel` → Tomorrow button | Zustand `scheduledTasks` | **P2** |
| `PATCH` | `/api/members/{id}/override` | `PersonCard` → dropdown menu | Zustand `overrides` | **P1** |
| `DELETE` | `/api/members/{id}/override` | `PersonCard` → "Clear override" | Zustand `clearOverride` | **P1** |
| `POST` | `/ping` *(wire frontend)* | `SuggestionPanel` → "Check availability" | — (API exists, needs wiring) | **P1** |

---

## 14. Implementation order (recommended)

1. **Create `data_loader.py`** — extract parsing logic so both the server and scorer share it.
2. **`GET /api/tasks`** + **`GET /api/members`** — these unblock every page.
3. **`GET /api/sync`** — unblocks the stale banner and WeekChart.
4. **`PATCH /api/members/{id}/override` + `DELETE`** — small, high-value for team leads.
5. **`PATCH /api/tasks/{id}/status`** — persists reassignments across refreshes.
6. **Wire `POST /ping`** in `SuggestionPanel.tsx`.
7. **`POST /api/tasks/{id}/schedule`** — lowest priority, currently purely cosmetic.

---

## 15. Environment / config

Add to `backend/.env` (and `.env.example`):

```env
# Base URL the Next.js frontend uses to reach the FastAPI backend
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

In the Next.js frontend, create `coverageiq/lib/api.ts`:
```ts
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}
```

Use `apiFetch` everywhere instead of hardcoded localhost URLs.

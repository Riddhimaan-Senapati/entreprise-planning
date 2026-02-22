# Slack Availability Sync — Feature Plan

## Overview

Use the existing `slack_parser.py` pipeline to automatically detect time-off announcements
from a Slack channel and apply those OOO statuses directly to team members in the database.
Managers see a one-click "Sync from Slack" button that pulls recent messages, runs them through
Gemini AI, and updates the Team Directory without any manual entry.

---

## How It Fits Into the Existing System

```
Slack channel
    └─ fetch_and_parse()          ← already in slack_parser.py
           │
           ▼
    list[TimeOffEntry]            ← person_username, start_date, end_date
           │
           ▼
    apply_timeoff_entries()       ← new CRUD: fuzzy-match → set leave_status='ooo'
           │                                                    + slack_ooo_until
           ▼
    TeamMember.leave_status       ← same field used everywhere (PersonCard, TeamGrid, team page)
    TeamMember.slack_ooo_until    ← new field: auto-restore date
```

The existing manual override system (`manually_overridden`, Zustand `overrides`) is unchanged.
Slack-sourced OOO is a separate layer that can still be overridden manually.

---

## 1. Backend

### 1a. DB Model change — `TeamMember`

Add one new nullable column to `TeamMember` in `models.py`:

```python
slack_ooo_until: Optional[datetime] = None
# ISO datetime when Slack-detected OOO expires; None = not Slack-OOO'd
```

> **Migration note:** SQLite doesn't support `ALTER COLUMN`.
> Delete `coverageiq.db` and re-run `seed.py` after this change.

---

### 1b. New response schema

Add to `models.py`:

```python
class TimeOffSyncResult(BaseModel):
    """Returned by POST /timeoff/sync."""
    scanned:  int            # total Slack messages parsed
    detected: int            # how many were classified as time-off
    applied:  int            # how many matched a known team member
    skipped:  int            # detected but couldn't match to a member
    changes:  list[MemberOOOChange]

class MemberOOOChange(BaseModel):
    memberId:   str
    memberName: str
    personUsername: str      # Slack name that was matched
    startDate:  Optional[str]
    endDate:    Optional[str]
    reason:     Optional[str]
    coverageBy: Optional[str]
```

---

### 1c. New CRUD — `crud.py`

**`apply_timeoff_entries(db, entries) -> TimeOffSyncResult`**

1. For each `TimeOffEntry`:
   - Normalise `person_username` (lowercase, strip `@`, replace `.` with space)
   - Fuzzy-match against all `TeamMember.name` values using `difflib.SequenceMatcher`
     with a threshold of `≥ 0.75`
   - If matched and `start_date` ≤ today ≤ `end_date` (or no `end_date`):
     - Set `leave_status = 'ooo'`, `is_ooo = True`
     - Set `slack_ooo_until` = parsed `end_date` (or `None`)
     - Set `manually_overridden = False` (AI-sourced, not human)
   - If entry's date range has already passed: skip (stale)

2. Commit all changes in one transaction.

3. Return `TimeOffSyncResult`.

**`restore_expired_slack_ooo(db) -> list[str]`**

- Query members where `slack_ooo_until IS NOT NULL AND slack_ooo_until < now()`
- Reset `leave_status = 'available'`, `is_ooo = False`, `slack_ooo_until = None`
- Return list of restored member IDs (for logging)

---

### 1d. New router — `routers/timeoff.py`

```
POST /timeoff/sync
```

- Query params: `hours: int = 24`, `limit: int = 100` (same as existing `GET /timeoff`)
- Calls `restore_expired_slack_ooo(db)` first (clean up past OOOs)
- Calls `fetch_and_parse(slack_client, channel_id, hours, limit)`
- Calls `apply_timeoff_entries(db, entries)`
- Returns `TimeOffSyncResult`

```
GET /timeoff
```

Move the existing `GET /timeoff` endpoint from `main.py` into this router (no behaviour change).

---

### 1e. Auto-restore on startup

In `main.py` lifespan, after `seed(db)`, call `restore_expired_slack_ooo(db)`.
This ensures stale OOOs are cleaned up automatically each time the server boots.

---

### 1f. Name matching strategy (implementation detail)

```python
import difflib

def _best_member_match(username: str, members: list[TeamMember]) -> TeamMember | None:
    # normalise: strip @, dots→space, lowercase, strip
    norm = username.lstrip("@").replace(".", " ").strip().lower()
    best_ratio, best_member = 0.0, None
    for m in members:
        ratio = difflib.SequenceMatcher(None, norm, m.name.lower()).ratio()
        if ratio > best_ratio:
            best_ratio, best_member = ratio, m
    return best_member if best_ratio >= 0.75 else None
```

Edge cases:
- Slack username is first name only (e.g. `"maya"`) → still matches `"Maya Patel"` if ratio ≥ 0.75
- Multiple people with same first name → pick highest-ratio match; log ambiguity warning
- No match → increment `skipped` counter in result

---

## 2. Frontend

### 2a. API client — `lib/api-client.ts`

Add two functions:

```typescript
// Triggers the Slack sync pipeline
export async function syncTimeOff(hours = 24): Promise<TimeOffSyncResult>

// Fetches raw time-off entries without applying to DB
export async function fetchTimeOffEntries(hours = 24): Promise<TimeOffEntry[]>
```

New types in `lib/types.ts`:

```typescript
export interface MemberOOOChange {
  memberId:       string;
  memberName:     string;
  personUsername: string;
  startDate:      string | null;
  endDate:        string | null;
  reason:         string | null;
  coverageBy:     string | null;
}

export interface TimeOffSyncResult {
  scanned:  number;
  detected: number;
  applied:  number;
  skipped:  number;
  changes:  MemberOOOChange[];
}

export interface TimeOffEntry {
  sentAt:           string;
  sender:           string;
  message:          string;
  personUsername:   string;
  startDate:        string | null;
  endDate:          string | null;
  reason:           string | null;
  coverageUsername: string | null;
  notes:            string | null;
}
```

---

### 2b. New hook — `hooks/use-api.ts`

```typescript
export function useTimeOffSync() {
  // SWR mutation — not a fetch, triggered manually
  return useSWRMutation('/timeoff/sync', ...)
}
```

---

### 2c. New page — `app/slack-sync/page.tsx`

Route: `/slack-sync`

**Layout (two-column on desktop, stacked on mobile):**

```
┌──────────────────────────────────────────────────────────────────┐
│  Slack Availability Sync                                         │
│  Last synced: 3 hours ago · Channel: #time-off                  │
│                                                                  │
│  [ Sync now (last 24h) ▾ ]   [ View raw messages ]              │
└──────────────────────────────────────────────────────────────────┘

┌────────────────────────────┐  ┌──────────────────────────────────┐
│  Last Sync Results         │  │  Raw Time-Off Messages           │
│                            │  │                                  │
│  ✓ 47 messages scanned     │  │  Jordan Lee · 2h ago             │
│  ✓  3 time-off detected    │  │  "OOO Mon–Fri next week,         │
│  ✓  3 members updated      │  │   Alex covering me"              │
│  !  0 skipped              │  │  → OOO 2/24–2/28 · covered by   │
│                            │  │    Alex Kim                      │
│  ── Changes ──             │  │                                  │
│                            │  │  Maya Patel · 1d ago             │
│  [JL] Jordan Lee           │  │  "Taking Thursday off for        │
│  OOO 2/24 → 2/28           │  │   dentist appt"                  │
│  Coverage: Alex Kim        │  │  → OOO 2/26 · no coverage        │
│                            │  │                                  │
│  [MP] Maya Patel           │  │  ...                             │
│  OOO 2/26                  │  │                                  │
│  Reason: dentist           │  └──────────────────────────────────┘
│                            │
└────────────────────────────┘
```

**Key interactions:**
- "Sync now" button: calls `POST /timeoff/sync`, shows spinner, then renders results
- Dropdown on button: choose lookback window (24h / 48h / 7 days)
- "View raw messages" toggle: shows the unprocessed `TimeOffEntry` list (the Gemini output)
- Each change card links to the member in the Team Directory

---

### 2d. SummaryBar addition

Add a small "Sync" button next to the `Last synced` timestamp that triggers a quick sync
and shows a toast with the result count:

```
"Synced from Slack — 2 members marked OOO"
```

---

### 2e. Nav link

Add "Slack Sync" to the sidebar nav (after Team Directory).

---

## 3. Interaction with Existing Override System

| Source          | `leave_status` | `manually_overridden` | `slack_ooo_until` |
|-----------------|----------------|-----------------------|--------------------|
| DB seed default | available       | false                 | null               |
| Slack AI sync   | ooo             | **false**             | end_date or null   |
| Manual override | ooo / available | **true**              | null               |

Rules:
- A **manual override always wins** — `PersonCard` already reads Zustand first, then DB.
  No code change needed; `manually_overridden = true` is just metadata.
- **Auto-restore** only clears Slack-sourced OOO (`slack_ooo_until IS NOT NULL`).
  It never clears manual overrides.
- If a manager manually marks someone `available` after a Slack sync sets them `ooo`,
  the manual override wins in the UI immediately (Zustand) and persists to DB.

---

## 4. Environment Variables (no new ones required)

The feature reuses:
- `SLACK_BOT_TOKEN` — already required
- `SLACK_CHANNEL_ID` — already required
- `GEMINI_API_KEY` — already required

Optional future addition:
- `SLACK_TIMEOFF_CHANNEL_ID` — if the time-off channel is different from the general
  ping channel. For now, default to `SLACK_CHANNEL_ID`.

---

## 5. Implementation Order

1. **`models.py`** — add `slack_ooo_until` field
2. **Delete DB + reseed** — `python seed.py`
3. **`crud.py`** — add `apply_timeoff_entries` + `restore_expired_slack_ooo`
4. **`routers/timeoff.py`** — new router with `POST /timeoff/sync` + move `GET /timeoff`
5. **`main.py`** — include new router, add `restore_expired_slack_ooo` to lifespan
6. **`lib/types.ts`** — add `TimeOffSyncResult`, `MemberOOOChange`, `TimeOffEntry`
7. **`lib/api-client.ts`** — add `syncTimeOff`, `fetchTimeOffEntries`
8. **`hooks/use-api.ts`** — add `useTimeOffSync` mutation hook
9. **`app/slack-sync/page.tsx`** — new page
10. **Sidebar nav** — add link
11. **`SummaryBar.tsx`** — add quick-sync button + toast

---

## 6. Out of Scope (future work)

- Webhook-based real-time sync (Slack Events API) — would replace polling
- Per-member Slack user ID mapping (currently matching by display name only)
- OOO calendar block creation (write back to calendar)
- Coverage confirmation flow (currently just recorded, not enforced)

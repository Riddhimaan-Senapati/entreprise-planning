"""
data_loader.py
==============
Shared data utilities for the CoverageIQ backend.

Responsibilities:
  1. Parse coverageiq/lib/mock-data.ts into Python dicts (TypeScript → JSON).
  2. Merge backend/skill_scores.json into task suggestions.
  3. Compute real calendar availability from .ics files (via calendar_availability.py).
  4. Expose load_tasks() and load_members() used by main.py and score_skills.py.

Imported by: main.py, score_skills.py
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

# ── Paths ──────────────────────────────────────────────────────────────────────

REPO_ROOT         = Path(__file__).parent.parent
MOCK_DATA_PATH    = REPO_ROOT / "coverageiq" / "lib" / "mock-data.ts"
SKILL_SCORES_PATH = Path(__file__).parent / "skill_scores.json"

# Members with associated ICS files.  Add entries here as more calendars are linked.
# Key = Slack/system memberId, Value = path relative to backend/.
CALENDAR_ICS_MAP: dict[str, Path] = {
    "mem-012": Path(__file__).parent / "dummy_maya_calendar.ics",
}


# ── TypeScript parser helpers ──────────────────────────────────────────────────

def _str_field(text: str, field: str) -> Optional[str]:
    """Extract a single/double-quoted string field value."""
    match = re.search(
        rf"{re.escape(field)}:\s*(?:'([^']*)'|\"([^\"]*)\")", text
    )
    if not match:
        return None
    return match.group(1) if match.group(1) is not None else match.group(2)


def _int_field(text: str, field: str) -> Optional[int]:
    """Extract an integer field value."""
    match = re.search(rf"{re.escape(field)}:\s*(\d+)", text)
    return int(match.group(1)) if match else None


def _float_field(text: str, field: str) -> Optional[float]:
    """Extract a float/integer field value."""
    match = re.search(rf"{re.escape(field)}:\s*([0-9]+(?:\.[0-9]+)?)", text)
    return float(match.group(1)) if match else None


def _bool_field(text: str, field: str) -> Optional[bool]:
    """Extract a boolean field value (true/false)."""
    match = re.search(rf"{re.escape(field)}:\s*(true|false)", text)
    if not match:
        return None
    return match.group(1) == "true"


def _list_field(text: str, field: str) -> list[str]:
    """Extract a string array field, e.g. skills: ['a', 'b']."""
    match = re.search(rf"{re.escape(field)}:\s*\[([^\]]+)\]", text)
    if not match:
        return []
    return re.findall(r"['\"]([^'\"]+)['\"]", match.group(1))


def _split_objects(block: str) -> list[str]:
    """Split a JS/TS array body into top-level { } object strings."""
    objects = []
    depth   = 0
    start   = None
    for i, ch in enumerate(block):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(block[start: i + 1])
                start = None
    return objects


def _parse_deadline_hours(block: str) -> Optional[float]:
    """
    Extract the deadline hour-offset from TS patterns like:
        new Date(now.getTime() + 26 * 60 * 60 * 1000)        → 26 h
        new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)   → 120 h
    """
    # Days form (more specific, checked first)
    m = re.search(
        r"now\.getTime\(\)\s*\+\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000",
        block,
    )
    if m:
        return float(m.group(1)) * 24

    # Hours form
    m = re.search(
        r"now\.getTime\(\)\s*\+\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000",
        block,
    )
    if m:
        return float(m.group(1))

    return None


# ── Mock-data.ts parser ────────────────────────────────────────────────────────

def parse_mock_data(path: Path) -> tuple[list[dict], dict[str, dict]]:
    """
    Parse atRiskTasks and teamMembers from mock-data.ts.

    Returns:
        tasks:   list of task dicts — id, title, priority, status, assigneeId,
                 projectName, deadline_hours_offset, suggestions (with skill scores)
        members: dict keyed by memberId → full member dict including dataSources,
                 weekAvailability, confidenceScore, isOOO, currentTaskIndices
    """
    source = path.read_text(encoding="utf-8")

    # ── Tasks ──────────────────────────────────────────────────────────────────
    tasks_match = re.search(
        r"export const atRiskTasks[^=]*=\s*\[(.+?)\];\s*\n",
        source, re.DOTALL,
    )
    if not tasks_match:
        raise ValueError("Could not locate atRiskTasks array in mock-data.ts")

    tasks: list[dict] = []
    for task_block in _split_objects(tasks_match.group(1)):
        task_id = _str_field(task_block, "id")
        if not task_id:
            continue

        sugg_match = re.search(r"suggestions:\s*\[(.+?)\]", task_block, re.DOTALL)
        suggestions: list[dict] = []
        if sugg_match:
            for s in _split_objects(sugg_match.group(1)):
                mid    = _str_field(s, "memberId")
                reason = _str_field(s, "contextReason")
                skill  = _int_field(s, "skillMatchPct")
                wload  = _int_field(s, "workloadPct")
                if mid:
                    suggestions.append({
                        "memberId":     mid,
                        "skillMatchPct": skill or 0,
                        "workloadPct":   wload or 0,
                        "contextReason": reason or "",
                    })

        tasks.append({
            "id":                    task_id,
            "title":                 _str_field(task_block, "title")    or "",
            "priority":              _str_field(task_block, "priority") or "",
            "status":                _str_field(task_block, "status")   or "at-risk",
            "assigneeId":            _str_field(task_block, "assigneeId") or "",
            "projectName":           _str_field(task_block, "projectName") or "",
            "deadline_hours_offset": _parse_deadline_hours(task_block),
            "suggestions":           suggestions,
        })

    # ── Members ────────────────────────────────────────────────────────────────
    members_match = re.search(
        r"export const teamMembers[^=]*=\s*\[(.+)\];\s*\n",
        source, re.DOTALL,
    )
    if not members_match:
        raise ValueError("Could not locate teamMembers array in mock-data.ts")

    members: dict[str, dict] = {}
    for mem_block in _split_objects(members_match.group(1)):
        mid = _str_field(mem_block, "id")
        if not mid or not mid.startswith("mem-"):
            continue

        # dataSources sub-object: { calendarPct: N, taskLoadHours: N, leaveStatus: '...' }
        ds_match = re.search(r"dataSources:\s*\{([^}]+)\}", mem_block)
        data_sources: dict = {"calendarPct": 0, "taskLoadHours": 0.0, "leaveStatus": "available"}
        if ds_match:
            ds = ds_match.group(1)
            data_sources = {
                "calendarPct":   _int_field(ds, "calendarPct")   or 0,
                "taskLoadHours": _float_field(ds, "taskLoadHours") or 0.0,
                "leaveStatus":   _str_field(ds, "leaveStatus")   or "available",
            }

        # weekAvailability sub-object: { monday: N, tuesday: N, ... }
        wa_match = re.search(r"weekAvailability:\s*\{([^}]+)\}", mem_block)
        week_avail: dict = {d: 0 for d in ("monday", "tuesday", "wednesday", "thursday", "friday")}
        if wa_match:
            wa = wa_match.group(1)
            week_avail = {
                "monday":    _int_field(wa, "monday")    or 0,
                "tuesday":   _int_field(wa, "tuesday")   or 0,
                "wednesday": _int_field(wa, "wednesday") or 0,
                "thursday":  _int_field(wa, "thursday")  or 0,
                "friday":    _int_field(wa, "friday")    or 0,
            }

        # currentTasks references: e.g. [atRiskTasks[0], atRiskTasks[2]]
        current_task_indices = list(map(int, re.findall(r"atRiskTasks\[(\d+)\]", mem_block)))

        members[mid] = {
            "id":                 mid,
            "name":               _str_field(mem_block, "name")          or mid,
            "role":               _str_field(mem_block, "role")          or "",
            "team":               _str_field(mem_block, "team")          or "Engineering",
            "confidenceScore":    _int_field(mem_block, "confidenceScore") or 50,
            "skills":             _list_field(mem_block, "skills"),
            "dataSources":        data_sources,
            "currentTaskIndices": current_task_indices,
            "isOOO":              _bool_field(mem_block, "isOOO") or False,
            "weekAvailability":   week_avail,
        }

    return tasks, members


# ── Parse weekChartData from mock-data.ts ─────────────────────────────────────

def parse_week_chart_data(path: Path) -> list[dict]:
    """Parse the weekChartData export: [{ day: 'Mon', available: 16 }, ...]."""
    source = path.read_text(encoding="utf-8")
    match = re.search(r"export const weekChartData\s*=\s*\[([^\]]+)\]", source, re.DOTALL)
    if not match:
        return []
    points = []
    for obj in _split_objects(match.group(1)):
        day = _str_field(obj, "day")
        avail = _int_field(obj, "available")
        if day and avail is not None:
            points.append({"day": day, "available": avail})
    return points


# ── Calendar availability ──────────────────────────────────────────────────────

def _current_work_week_start() -> date:
    """Return the Monday of the current (or upcoming if weekend) work week."""
    today   = date.today()
    weekday = today.weekday()   # Monday=0, Sunday=6
    if weekday < 5:             # Mon–Fri: rewind to this Monday
        return today - timedelta(days=weekday)
    else:                       # Sat–Sun: advance to next Monday
        return today + timedelta(days=(7 - weekday))


def get_calendar_availability(member_id: str) -> Optional[dict]:
    """
    If the member has an ICS file in CALENDAR_ICS_MAP, compute their actual
    per-day and overall availability for the current/upcoming work week.

    Returns:
        {
            "weekAvailability": { "monday": int, ..., "friday": int },
            "calendarPct":      int,          # overall week availability 0-100
        }
    or None if no ICS is mapped for this member.
    """
    from calendar_availability import get_availability_report

    ics_path = CALENDAR_ICS_MAP.get(member_id)
    if not ics_path or not ics_path.exists():
        return None

    monday      = _current_work_week_start()
    next_monday = monday + timedelta(weeks=1)

    report = get_availability_report(
        ics_path    = str(ics_path),
        range_start = monday,
        range_end   = next_monday,
        timezone    = "UTC",
    )

    day_name_map = {
        "Monday": "monday", "Tuesday": "tuesday", "Wednesday": "wednesday",
        "Thursday": "thursday", "Friday": "friday",
    }
    week_avail: dict[str, int] = {
        "monday": 0, "tuesday": 0, "wednesday": 0, "thursday": 0, "friday": 0
    }
    for day in report["per_day"]:
        key = day_name_map.get(day["weekday"])
        if key:
            week_avail[key] = round(day["availability_pct"])

    return {
        "weekAvailability": week_avail,
        "calendarPct":      round(report["availability_pct"]),
    }


# ── Public loaders ─────────────────────────────────────────────────────────────

def load_tasks(
    now:              Optional[datetime]    = None,
    status_overrides: Optional[dict[str, str]]  = None,
    scheduled_tasks:  Optional[dict[str, bool]] = None,
) -> list[dict]:
    """
    Return all at-risk tasks with:
    - Absolute ISO deadline (derived from mock-data's relative offset + `now`)
    - AI skill scores merged from skill_scores.json (falls back to mock values)
    - Runtime status and scheduled overrides applied

    Args:
        now:              Current UTC time (defaults to datetime.utcnow()).
        status_overrides: {taskId: status} — from PATCH /api/tasks/{id}/status.
        scheduled_tasks:  {taskId: True}   — from POST /api/tasks/{id}/schedule.
    """
    if now is None:
        now = datetime.now(tz=timezone.utc)
    if status_overrides is None:
        status_overrides = {}
    if scheduled_tasks is None:
        scheduled_tasks = {}

    tasks, _ = parse_mock_data(MOCK_DATA_PATH)

    # Load AI skill scores; fall back gracefully if file missing
    scores: dict = {}
    if SKILL_SCORES_PATH.exists():
        scores = json.loads(SKILL_SCORES_PATH.read_text(encoding="utf-8"))

    result: list[dict] = []
    for task in tasks:
        task_id     = task["id"]
        task_scores = scores.get(task_id, {})

        # Deep-copy suggestions so we don't mutate the parsed cache
        suggestions = []
        for s in task["suggestions"]:
            scored = task_scores.get(s["memberId"])
            suggestions.append({
                "memberId":     s["memberId"],
                "skillMatchPct": scored["skillMatchPct"] if scored else s["skillMatchPct"],
                "workloadPct":   s["workloadPct"],
                "contextReason": scored["contextReason"] if scored else s["contextReason"],
            })

        # Compute absolute deadline from relative offset
        offset_hours = task.get("deadline_hours_offset")
        if offset_hours is not None:
            deadline_str = (now + timedelta(hours=offset_hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
        else:
            deadline_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

        result.append({
            "id":          task_id,
            "title":       task["title"],
            "priority":    task["priority"],
            "assigneeId":  task["assigneeId"],
            "deadline":    deadline_str,
            "projectName": task["projectName"],
            "status":      status_overrides.get(task_id, task["status"]),
            "scheduled":   scheduled_tasks.get(task_id, False),
            "suggestions": suggestions,
        })

    return result


def load_members(
    tasks:            Optional[list[dict]]       = None,
    member_overrides: Optional[dict[str, str]]   = None,
    last_synced:      Optional[datetime]          = None,
) -> list[dict]:
    """
    Return all team members with:
    - Real calendar availability for ICS-mapped members (e.g. Maya/mem-012)
    - currentTasks resolved from task index references
    - Manual status overrides applied (dataSources.leaveStatus + isOOO)

    Args:
        tasks:            Pre-loaded tasks (from load_tasks()); if None, loaded internally.
        member_overrides: {memberId: 'available'|'partial'|'ooo'} from PATCH override endpoint.
        last_synced:      Timestamp to report as lastSynced (defaults to 3h ago).
    """
    if member_overrides is None:
        member_overrides = {}
    if last_synced is None:
        last_synced = datetime.now(tz=timezone.utc) - timedelta(hours=3)
    last_synced_str = last_synced.isoformat()

    _, members = parse_mock_data(MOCK_DATA_PATH)

    # Resolve currentTasks from index references
    if tasks is None:
        tasks = load_tasks()
    task_list = list(tasks)  # ordered, index 0..N mirrors atRiskTasks order

    result: list[dict] = []
    for mid, m in members.items():
        # ── Calendar override for ICS-mapped members ──────────────────────────
        cal = get_calendar_availability(mid)
        if cal:
            m["dataSources"]["calendarPct"] = cal["calendarPct"]
            m["weekAvailability"]           = cal["weekAvailability"]

        # ── Manual status override (from PATCH /api/members/{id}/override) ────
        override_status = member_overrides.get(mid)
        if override_status:
            m["dataSources"]["leaveStatus"] = override_status
            m["isOOO"] = (override_status == "ooo")

        # ── Resolve currentTasks by index ─────────────────────────────────────
        current_tasks = []
        for idx in m.get("currentTaskIndices", []):
            if idx < len(task_list):
                current_tasks.append(task_list[idx])

        result.append({
            "id":              m["id"],
            "name":            m["name"],
            "role":            m["role"],
            "team":            m["team"],
            "confidenceScore": m["confidenceScore"],
            "skills":          m["skills"],
            "dataSources":     m["dataSources"],
            "currentTasks":    current_tasks,
            "isOOO":           m["isOOO"],
            "lastSynced":      last_synced_str,
            "weekAvailability": m["weekAvailability"],
        })

    return result

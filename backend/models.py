"""
models.py
---------
SQLModel table definitions (DB layer) + Pydantic response schemas (API layer).

Table models use snake_case Python conventions.
Response schemas use camelCase to match the TypeScript interfaces in lib/types.ts exactly,
so the frontend can consume the API without any field-name transformation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


# ── DB Table Models ────────────────────────────────────────────────────────────

class TeamMember(SQLModel, table=True):
    """
    Persisted team member.  `skills` is stored as a JSON array in SQLite.
    `ics_path` is a path relative to the backend/ directory; when set,
    the /members/{id}/availability and /members/{id}/calendar/sync
    endpoints will use it to compute real availability from the ICS file.
    """
    __tablename__ = "team_members"

    id:               str            = Field(primary_key=True)
    name:             str
    role:             str
    team:             str            # "Engineering" | "Design" | "Product"
    confidence_score: float          = Field(ge=0, le=100)
    skills:           list[str]      = Field(default=[], sa_column=Column(JSON))
    calendar_pct:     float          = Field(ge=0, le=100, default=0.0)
    task_load_hours:  float          = Field(ge=0, default=0.0)
    leave_status:     str            = "available"   # "available" | "partial" | "ooo"
    is_ooo:              bool           = False
    manually_overridden: bool           = False
    ics_path:            Optional[str]  = None
    last_synced:         datetime       = Field(default_factory=datetime.utcnow)
    manager_notes:       str            = ""


class WeekAvailability(SQLModel, table=True):
    """One row per team member; day columns hold 0-100 availability scores."""
    __tablename__ = "week_availabilities"

    id:        Optional[int] = Field(default=None, primary_key=True)
    member_id: str           = Field(foreign_key="team_members.id", unique=True, index=True)
    monday:    float         = 0.0
    tuesday:   float         = 0.0
    wednesday: float         = 0.0
    thursday:  float         = 0.0
    friday:    float         = 0.0


class Task(SQLModel, table=True):
    __tablename__ = "tasks"

    id:           str           = Field(primary_key=True)
    title:        str
    priority:     str                        # "P0" | "P1" | "P2"
    assignee_id:  Optional[str] = Field(default=None, foreign_key="team_members.id", index=True)
    deadline:     datetime
    project_name: str
    status:       str           = "at-risk"  # "at-risk" | "unassigned" | "covered"


class Suggestion(SQLModel, table=True):
    __tablename__ = "suggestions"

    id:              Optional[int] = Field(default=None, primary_key=True)
    task_id:         str           = Field(foreign_key="tasks.id", index=True)
    member_id:       str           = Field(foreign_key="team_members.id")
    skill_match_pct: float
    workload_pct:    float
    context_reason:  str
    rank:            int           = 0  # 0 = top-ranked suggestion


# ── API Response Schemas ───────────────────────────────────────────────────────
# Field names match the TypeScript interfaces in coverageiq/lib/types.ts.

class DataSourceSignalOut(BaseModel):
    calendarPct:    float
    taskLoadHours:  float
    leaveStatus:    str


class WeekAvailabilityOut(BaseModel):
    monday:    float
    tuesday:   float
    wednesday: float
    thursday:  float
    friday:    float


class SuggestionOut(BaseModel):
    memberId:      str
    skillMatchPct: float
    workloadPct:   float
    contextReason: str


class TaskOut(BaseModel):
    id:          str
    title:       str
    priority:    str
    assigneeId:  Optional[str]
    deadline:    datetime
    projectName: str
    status:      str
    suggestions: list[SuggestionOut] = []


class TeamMemberOut(BaseModel):
    id:               str
    name:             str
    role:             str
    team:             str
    confidenceScore:  float
    skills:           list[str]
    dataSources:      DataSourceSignalOut
    isOOO:            bool
    lastSynced:       datetime
    weekAvailability: WeekAvailabilityOut
    currentTasks:       list[TaskOut] = []
    icsLinked:          bool = False   # true when an ICS file is attached
    manuallyOverridden: bool = False   # true when leave status was manually set
    managerNotes:       str  = ""


class SummaryOut(BaseModel):
    ooo:                    int
    partial:                int
    fullyAvailable:         int
    criticalAtRisk:         int
    unresolvedReassignments: int
    lastSynced:             datetime


class StatusUpdate(BaseModel):
    status: str


class OverrideUpdate(BaseModel):
    leaveStatus: str  # "available" | "partial" | "ooo"


class NotesUpdate(BaseModel):
    notes: str


class SkillsUpdate(BaseModel):
    skills: list[str]


class TaskCreate(BaseModel):
    title:       str
    priority:    str               # "P0" | "P1" | "P2"
    assigneeId:  Optional[str] = None   # None → unassigned; provided → covered
    deadline:    datetime
    projectName: str

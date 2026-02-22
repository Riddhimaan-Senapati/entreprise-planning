"""
routers/chat.py
---------------
Agentic chatbot endpoint powered by PydanticAI + Gemini.

The agent has tools to:
  - Read team members, tasks, and the availability summary
  - Assign / unassign tasks, update status, create / delete tasks
  - Override member leave status

Write actions are gated by a confirmation step enforced in the system prompt.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    UserPromptPart,
    TextPart,
)
from sqlmodel import Session

from crud import (
    assign_task,
    create_task as crud_create_task,
    delete_task,
    get_all_members,
    get_all_tasks,
    get_member_out,
    get_summary,
    get_task_out,
    reset_member_override,
    tick_slack_ooo_status,
    unassign_task,
    update_member_override,
    update_task_status,
)
from database import get_session
from models import TaskCreate

router = APIRouter(prefix="/chat", tags=["chat"])

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Vantage AI, an intelligent assistant built into the Vantage team \
coverage platform. You help engineering managers understand team availability, \
identify task coverage risks, and take action to resolve gaps.

You have access to real-time data about:
- Team members: availability, skills, leave status, workload, week schedule
- Tasks: at-risk assignments with ranked coverage suggestions
- Time-off synced from Slack and Gmail

WRITE ACTION PROTOCOL:
Before calling any tool that modifies data (assigning tasks, updating task status, \
creating or deleting tasks, overriding a member's leave status) you MUST:
1. Describe exactly what you are about to do in plain language.
2. Ask: "Shall I proceed? (yes / no)"
3. Only call the write tool after the user explicitly confirms ("yes", "proceed", \
"do it", "confirm", etc.).

If the user has NOT confirmed, do NOT call any write tool — describe the action only.
For read-only queries respond immediately without asking.

Format responses in markdown where useful. Be concise and professional.
"""

# ── Dependency dataclass ──────────────────────────────────────────────────────

@dataclass
class ChatDeps:
    db: Session


# ── Agent ─────────────────────────────────────────────────────────────────────

agent = Agent(
    model="google-gla:gemini-2.5-flash",
    deps_type=ChatDeps,
    system_prompt=SYSTEM_PROMPT,
)

# ── Read tools ────────────────────────────────────────────────────────────────

@agent.tool
def tool_get_members(ctx: RunContext[ChatDeps]) -> str:
    """Get all team members with their availability, skills, and leave status."""
    tick_slack_ooo_status(ctx.deps.db)
    members = get_all_members(ctx.deps.db)
    return json.dumps([m.model_dump() for m in members], default=str)


@agent.tool
def tool_get_member(ctx: RunContext[ChatDeps], member_id: str) -> str:
    """Get a single team member by their ID (e.g. 'mem-001')."""
    out = get_member_out(ctx.deps.db, member_id)
    if not out:
        return f"Member '{member_id}' not found."
    return json.dumps(out.model_dump(), default=str)


@agent.tool
def tool_get_tasks(ctx: RunContext[ChatDeps], status: str = "") -> str:
    """Get all tasks, optionally filtered by status: 'at-risk', 'unassigned', or 'covered'."""
    tasks = get_all_tasks(ctx.deps.db, status_filter=status or None)
    return json.dumps([t.model_dump() for t in tasks], default=str)


@agent.tool
def tool_get_task(ctx: RunContext[ChatDeps], task_id: str) -> str:
    """Get a single task by ID, including ranked coverage suggestions."""
    out = get_task_out(ctx.deps.db, task_id)
    if not out:
        return f"Task '{task_id}' not found."
    return json.dumps(out.model_dump(), default=str)


@agent.tool
def tool_get_summary(ctx: RunContext[ChatDeps]) -> str:
    """Get the high-level team availability summary (available, OOO, at-risk counts)."""
    s = get_summary(ctx.deps.db)
    return json.dumps(s.model_dump(), default=str)


# ── Write tools ───────────────────────────────────────────────────────────────

@agent.tool
def tool_update_task_status(
    ctx: RunContext[ChatDeps], task_id: str, status: str
) -> str:
    """Update a task's status. Valid values: 'at-risk', 'unassigned', 'covered'."""
    row = update_task_status(ctx.deps.db, task_id, status)
    if not row:
        return f"Task '{task_id}' not found."
    return f"Task '{task_id}' status updated to '{status}'."


@agent.tool
def tool_reassign_task(
    ctx: RunContext[ChatDeps], task_id: str, member_id: str
) -> str:
    """Assign a team member to a task and mark it as covered."""
    row = assign_task(ctx.deps.db, task_id, member_id)
    if not row:
        return f"Task '{task_id}' not found."
    return f"Task '{task_id}' assigned to member '{member_id}' and marked as covered."


@agent.tool
def tool_unassign_task(ctx: RunContext[ChatDeps], task_id: str) -> str:
    """Remove the assignee from a task and set status to 'unassigned'."""
    row = unassign_task(ctx.deps.db, task_id)
    if not row:
        return f"Task '{task_id}' not found."
    return f"Task '{task_id}' unassigned."


@agent.tool
def tool_create_task(
    ctx: RunContext[ChatDeps],
    title: str,
    project_name: str,
    priority: str,
    deadline_hours: int = 24,
) -> str:
    """Create a new at-risk task. priority must be P0, P1, or P2. deadline_hours is hours from now."""
    now = datetime.now(timezone.utc)
    body = TaskCreate(
        title=title,
        priority=priority,
        deadline=now + timedelta(hours=deadline_hours),
        projectName=project_name,
    )
    row = crud_create_task(ctx.deps.db, body)
    from skill_pipeline import run_pipeline_for_task
    threading.Thread(target=run_pipeline_for_task, args=(row.id,), daemon=True).start()
    return f"Task '{row.id}' created: '{title}' ({priority}, deadline in {deadline_hours}h)."


@agent.tool
def tool_delete_task(ctx: RunContext[ChatDeps], task_id: str) -> str:
    """Delete a task and all its coverage suggestions."""
    found = delete_task(ctx.deps.db, task_id)
    if not found:
        return f"Task '{task_id}' not found."
    return f"Task '{task_id}' deleted."


@agent.tool
def tool_override_member_status(
    ctx: RunContext[ChatDeps], member_id: str, status: str
) -> str:
    """Manually override a team member's leave status. Valid: 'available' or 'ooo'."""
    row = update_member_override(ctx.deps.db, member_id, status)
    if not row:
        return f"Member '{member_id}' not found."
    return f"Member '{member_id}' leave status overridden to '{status}'."


@agent.tool
def tool_clear_member_override(ctx: RunContext[ChatDeps], member_id: str) -> str:
    """Clear the manual leave-status override for a member."""
    row = reset_member_override(ctx.deps.db, member_id)
    if not row:
        return f"Member '{member_id}' not found."
    return f"Member '{member_id}' override cleared."


# ── Request model ─────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str     # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


# ── Format conversion ─────────────────────────────────────────────────────────

def _to_model_messages(messages: list[ChatMessage]) -> list[ModelMessage]:
    """Convert frontend messages to PydanticAI ModelMessage history."""
    result: list[ModelMessage] = []
    for msg in messages:
        if msg.role == "user":
            result.append(ModelRequest(parts=[UserPromptPart(content=msg.content)]))
        elif msg.role == "assistant":
            result.append(ModelResponse(parts=[TextPart(content=msg.content)]))
    return result


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("")
async def chat_endpoint(body: ChatRequest, db: Session = Depends(get_session)):
    """
    Agentic chat. Accepts a messages array and streams the assistant's response
    as plain UTF-8 text chunks (Content-Type: text/plain; charset=utf-8).
    """
    if not body.messages:
        return StreamingResponse(iter([b"No messages provided."]), media_type="text/plain")

    user_prompt = body.messages[-1].content
    history = _to_model_messages(body.messages[:-1])
    deps = ChatDeps(db=db)

    async def generate():
        async with agent.run_stream(
            user_prompt,
            message_history=history,
            deps=deps,
        ) as result:
            async for delta in result.stream_text(delta=True):
                yield delta.encode("utf-8")

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")

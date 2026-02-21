"""
routers/tasks.py
----------------
FastAPI router for all /tasks endpoints.

Routes:
    POST /tasks              → create task (triggers skill pipeline in background)
    GET  /tasks              → list all tasks (optional ?status= filter)
    GET  /tasks/{id}         → single task with ranked suggestions
    PATCH /tasks/{id}/status  → update task status
    PATCH /tasks/{id}/unassign → remove assignee, re-run skill pipeline
    DELETE /tasks/{id}        → delete task and its suggestions
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlmodel import Session

from crud import (
    create_task,
    delete_task,
    get_all_tasks,
    get_task_out,
    unassign_task,
    update_task_status,
)
from database import get_session
from models import StatusUpdate, TaskCreate, TaskOut
from skill_pipeline import run_pipeline_for_task

router = APIRouter(prefix="/tasks", tags=["tasks"])

_VALID_STATUSES = {"at-risk", "unassigned", "covered"}
_VALID_PRIORITIES = {"P0", "P1", "P2"}


@router.post("", response_model=TaskOut, status_code=201)
def add_task(
    body: TaskCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
):
    """Create a task. Triggers the skill pipeline in the background to compute suggestions."""
    if body.priority not in _VALID_PRIORITIES:
        raise HTTPException(
            status_code=422,
            detail=f"priority must be one of {sorted(_VALID_PRIORITIES)}",
        )
    row = create_task(db, body)
    # Always run the pipeline so suggestions are ready for this task
    background_tasks.add_task(run_pipeline_for_task, row.id)
    return get_task_out(db, row.id)


@router.get("", response_model=list[TaskOut])
def list_tasks(
    status: str | None = Query(
        default=None,
        description="Filter by status: at-risk | unassigned | covered",
    ),
    db: Session = Depends(get_session),
):
    if status and status not in _VALID_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of {sorted(_VALID_STATUSES)}",
        )
    return get_all_tasks(db, status_filter=status)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: str, db: Session = Depends(get_session)):
    out = get_task_out(db, task_id)
    if not out:
        raise HTTPException(status_code=404, detail="Task not found")
    return out


@router.patch("/{task_id}/status", response_model=TaskOut)
def patch_task_status(
    task_id: str,
    body: StatusUpdate,
    db: Session = Depends(get_session),
):
    if body.status not in _VALID_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of {sorted(_VALID_STATUSES)}",
        )
    row = update_task_status(db, task_id, body.status)
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return get_task_out(db, task_id)


@router.patch("/{task_id}/unassign", response_model=TaskOut)
def patch_task_unassign(
    task_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
):
    """
    Remove the assignee from a task and set status to 'unassigned'.
    Clears existing suggestions and re-runs the skill pipeline in the background.
    """
    row = unassign_task(db, task_id)
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    background_tasks.add_task(run_pipeline_for_task, task_id)
    return get_task_out(db, task_id)


@router.delete("/{task_id}", status_code=204)
def remove_task(task_id: str, db: Session = Depends(get_session)):
    """Delete a task and all its suggestions."""
    found = delete_task(db, task_id)
    if not found:
        raise HTTPException(status_code=404, detail="Task not found")

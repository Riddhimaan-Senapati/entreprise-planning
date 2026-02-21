"""
routers/tasks.py
----------------
FastAPI router for all /tasks endpoints.

Routes:
    GET  /tasks              → list all tasks (optional ?status= filter)
    GET  /tasks/{id}         → single task with ranked suggestions
    PATCH /tasks/{id}/status → update task status
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from crud import get_all_tasks, get_task_out, update_task_status
from database import get_session
from models import StatusUpdate, TaskOut

router = APIRouter(prefix="/tasks", tags=["tasks"])

_VALID_STATUSES = {"at-risk", "unassigned", "covered"}


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

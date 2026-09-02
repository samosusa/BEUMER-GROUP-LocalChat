from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import get_db
from src.errors import AppError
from src.models.project import Project


router = APIRouter()

NAME_MAX_LENGTH = 200


class ProjectCreate(BaseModel):
    name: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _validate_name(name: str | None) -> str:
    name = name.strip() if name else ""
    if not name:
        raise AppError("ERR_VALIDATION", "Request validation failed", {"name": "must not be empty"})
    if len(name) > NAME_MAX_LENGTH:
        raise AppError(
            "ERR_VALIDATION",
            "Request validation failed",
            {"name": f"must be at most {NAME_MAX_LENGTH} characters"},
        )
    return name


def get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise AppError("ERR_NOT_FOUND", "Project not found", {"project_id": project_id}, status_code=404)
    return project


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> Project:
    name = _validate_name(payload.name)
    now = _now()
    project = Project(name=name, created_at=now, updated_at=now)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db)) -> list[Project]:
    return db.query(Project).order_by(Project.name.asc()).all()


@router.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int, db: Session = Depends(get_db)) -> Project:
    return get_project_or_404(db, project_id)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
def rename_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)) -> Project:
    project = get_project_or_404(db, project_id)
    project.name = _validate_name(payload.name)
    project.updated_at = _now()
    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> Response:
    project = get_project_or_404(db, project_id)
    # Documents' and conversations' own rows (and their chunks/messages, transitively)
    # cascade via the DB's ON DELETE CASCADE, mirroring conversation deletion below.
    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

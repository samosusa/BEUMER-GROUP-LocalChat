from __future__ import annotations

from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import SessionLocal, get_db
from src.ingest.pipeline import run_pipeline
from src.models.ingestion_job import IngestionJob


router = APIRouter()
SUPPORTED_SUFFIXES = {".pdf", ".md", ".markdown", ".txt"}


class IngestResponse(BaseModel):
    job_id: int


class IngestStatusResponse(BaseModel):
    status: str
    offset: int
    total_chunks: int
    last_checkpoint: dict | None


def process_upload(job_id: int, title: str, path: str) -> None:
    with SessionLocal() as db:
        run_pipeline(db, job_id, title, path)
    Path(path).unlink(missing_ok=True)


@router.post("/ingest", response_model=IngestResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    db: Session = Depends(get_db),
) -> IngestResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise HTTPException(status_code=400, detail="Only PDF, Markdown, and TXT files are supported")

    temporary_file = NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        temporary_file.write(await file.read())
        temporary_file.close()
        job = IngestionJob(status="queued", offset=0, total_chunks=0, created_at=datetime.utcnow())
        db.add(job)
        db.commit()
        db.refresh(job)
        job.status = "running"
        db.commit()
        background_tasks.add_task(process_upload, job.id, title, temporary_file.name)
        return IngestResponse(job_id=job.id)
    except Exception:
        temporary_file.close()
        Path(temporary_file.name).unlink(missing_ok=True)
        raise


@router.get("/status/{job_id}", response_model=IngestStatusResponse)
def ingestion_status(job_id: int, db: Session = Depends(get_db)) -> IngestStatusResponse:
    job = db.get(IngestionJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    return IngestStatusResponse(
        status=job.status,
        offset=job.offset,
        total_chunks=job.total_chunks,
        last_checkpoint=job.last_checkpoint,
    )
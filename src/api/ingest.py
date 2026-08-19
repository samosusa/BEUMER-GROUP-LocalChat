from __future__ import annotations

from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import SessionLocal, get_db
from src.errors import AppError
from src.ingest.loader import load_file
from src.ingest.pipeline import run_pipeline
from src.models.ingestion_job import IngestionJob
from src.validation import ROOT, validate_against_schema


router = APIRouter()
SUPPORTED_SUFFIXES = {".pdf", ".md", ".txt"}


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
    file: UploadFile | None = File(None),
    title: str | None = Form(None),
    project: bool | None = Form(False),
    db: Session = Depends(get_db),
) -> IngestResponse:
    validate_against_schema(
        {"title": title, "project": project},
        ROOT / "schemas" / "ingest.json",
    )
    if file is None:
        raise AppError("ERR_MISSING_FILE", "An upload file is required", {"file": "is required"})
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise AppError(
            "ERR_UNSUPPORTED_FORMAT",
            "Only PDF, Markdown, and TXT files are supported",
            {"file": file.filename or "unknown"},
        )

    temporary_file = NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        temporary_file.write(await file.read())
        temporary_file.close()
        try:
            load_file(temporary_file.name)
        except Exception as error:
            raise AppError(
                "ERR_PARSE_FAILED",
                "The uploaded file could not be parsed",
                {"file": file.filename or "unknown", "reason": str(error)},
                status_code=422,
            ) from error
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
        raise AppError("ERR_NOT_FOUND", "Ingestion job not found", {"job_id": job_id}, status_code=404)
    return IngestStatusResponse(
        status=job.status,
        offset=job.offset,
        total_chunks=job.total_chunks,
        last_checkpoint=job.last_checkpoint,
    )
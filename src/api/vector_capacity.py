from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import SessionLocal, get_db
from src.errors import AppError
from src.models.vector_capacity_job import VectorCapacityJob
from src.models.vector_capacity_result import VectorCapacityResult
from src.vector_capacity_benchmark import DEFAULT_STEPS, run_vector_capacity_job

router = APIRouter()


class VectorCapacityBenchmarkResponse(BaseModel):
    vector_capacity_job_id: int


class VectorCapacityBenchmarkStatusResponse(BaseModel):
    status: str
    progress: str
    current: str | None


class VectorCapacityResultRow(BaseModel):
    doc_count: int
    chunk_count: int
    step_docs: int
    step_s: float
    docs_per_s: float | None
    vector_dir_mb: float
    vector_file_count: int
    db_size_mb: float
    rss_mb: float
    query_count: int
    query_latency_ms_mean: float | None
    query_latency_ms_min: float | None
    query_latency_ms_max: float | None
    query_hits_mean: float | None
    run_at: datetime


class VectorCapacityBenchmarkResultsResponse(BaseModel):
    vector_capacity_job_id: int
    status: str
    results: list[VectorCapacityResultRow]


class VectorCapacityBenchmarkRunSummary(BaseModel):
    vector_capacity_job_id: int
    status: str
    steps: list[int]
    created_at: datetime
    finished_at: datetime | None


def process_vector_capacity_benchmark(job_id: int) -> None:
    with SessionLocal() as db:
        run_vector_capacity_job(db, job_id)


@router.post(
    "/vector-capacity/benchmark",
    response_model=VectorCapacityBenchmarkResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_vector_capacity_benchmark(
    background_tasks: BackgroundTasks, db: Session = Depends(get_db)
) -> VectorCapacityBenchmarkResponse:
    # No request body: unlike the other two benchmarks, this one has no model/device choice -
    # the subject under test is the FAISS vector store itself, always swept over the same
    # fixed document-count checkpoints.
    job = VectorCapacityJob(
        status="running",
        steps=list(DEFAULT_STEPS),
        total_steps=0,
        completed_steps=0,
        created_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(process_vector_capacity_benchmark, job.id)
    return VectorCapacityBenchmarkResponse(vector_capacity_job_id=job.id)


@router.get(
    "/vector-capacity/benchmark/status/{vector_capacity_job_id}",
    response_model=VectorCapacityBenchmarkStatusResponse,
)
def vector_capacity_benchmark_status(
    vector_capacity_job_id: int, db: Session = Depends(get_db)
) -> VectorCapacityBenchmarkStatusResponse:
    job = db.get(VectorCapacityJob, vector_capacity_job_id)
    if job is None:
        raise AppError(
            "ERR_NOT_FOUND",
            "Vector capacity benchmark job not found",
            {"vector_capacity_job_id": vector_capacity_job_id},
            status_code=404,
        )
    progress = f"{job.completed_steps} of {job.total_steps}" if job.total_steps else "starting"
    current = f"{job.current_doc_count} documents" if job.current_doc_count else None
    return VectorCapacityBenchmarkStatusResponse(status=job.status, progress=progress, current=current)


@router.get(
    "/vector-capacity/benchmark/results", response_model=list[VectorCapacityBenchmarkRunSummary]
)
def list_vector_capacity_benchmark_runs(
    db: Session = Depends(get_db),
) -> list[VectorCapacityBenchmarkRunSummary]:
    jobs = db.query(VectorCapacityJob).order_by(VectorCapacityJob.id.desc()).all()
    return [
        VectorCapacityBenchmarkRunSummary(
            vector_capacity_job_id=job.id,
            status=job.status,
            steps=job.steps,
            created_at=job.created_at,
            finished_at=job.finished_at,
        )
        for job in jobs
    ]


@router.get(
    "/vector-capacity/benchmark/results/{vector_capacity_job_id}",
    response_model=VectorCapacityBenchmarkResultsResponse,
)
def vector_capacity_benchmark_results(
    vector_capacity_job_id: int, db: Session = Depends(get_db)
) -> VectorCapacityBenchmarkResultsResponse:
    job = db.get(VectorCapacityJob, vector_capacity_job_id)
    if job is None:
        raise AppError(
            "ERR_NOT_FOUND",
            "Vector capacity benchmark job not found",
            {"vector_capacity_job_id": vector_capacity_job_id},
            status_code=404,
        )
    rows = (
        db.query(VectorCapacityResult)
        .filter_by(vector_capacity_job_id=job.id)
        .order_by(VectorCapacityResult.id)
        .all()
    )
    return VectorCapacityBenchmarkResultsResponse(
        vector_capacity_job_id=job.id,
        status=job.status,
        results=[
            VectorCapacityResultRow(
                doc_count=row.doc_count,
                chunk_count=row.chunk_count,
                step_docs=row.step_docs,
                step_s=row.step_s,
                docs_per_s=row.docs_per_s,
                vector_dir_mb=row.vector_dir_mb,
                vector_file_count=row.vector_file_count,
                db_size_mb=row.db_size_mb,
                rss_mb=row.rss_mb,
                query_count=row.query_count,
                query_latency_ms_mean=row.query_latency_ms_mean,
                query_latency_ms_min=row.query_latency_ms_min,
                query_latency_ms_max=row.query_latency_ms_max,
                query_hits_mean=row.query_hits_mean,
                run_at=row.run_at,
            )
            for row in rows
        ],
    )

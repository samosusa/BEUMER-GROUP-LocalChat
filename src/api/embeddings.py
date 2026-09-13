from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import SessionLocal, get_db
from src.embedding_benchmark import run_embedding_benchmark_job
from src.errors import AppError
from src.ingest.embedder import (
    EMBEDDING_MODELS,
    EmbeddingModelNotFoundError,
    embedding_adapter,
    list_embedding_models,
)
from src.models.embedding_benchmark_job import EmbeddingBenchmarkJob
from src.models.embedding_eval_result import EmbeddingEvalResult
from src.models.reindex_job import ReindexJob
from src.reindex import run_reindex_job

router = APIRouter()


class EmbeddingModelInfo(BaseModel):
    name: str
    dimension: int
    description: str


class ActiveEmbeddingModelResponse(BaseModel):
    model: str
    dimension: int


class SetActiveEmbeddingModelRequest(BaseModel):
    model: str


class SetActiveEmbeddingModelResponse(BaseModel):
    model: str
    dimension: int
    reindex_job_id: int


class ReindexStatusResponse(BaseModel):
    status: str
    model: str
    progress: str
    current_document: str | None


class ReindexRunSummary(BaseModel):
    reindex_job_id: int
    status: str
    model: str
    created_at: datetime
    finished_at: datetime | None


class EmbeddingBenchmarkRequest(BaseModel):
    models: list[str] | None = None


class EmbeddingBenchmarkResponse(BaseModel):
    embedding_benchmark_job_id: int


class EmbeddingBenchmarkStatusResponse(BaseModel):
    status: str
    progress: str
    current: str | None


class EmbeddingBenchmarkResultRow(BaseModel):
    model: str
    dimension: int | None
    status: str
    detail: str | None
    load_s: float | None
    text_label: str | None
    text_count: int | None
    embed_s: float | None
    texts_per_s: float | None
    peak_mem_mb: float | None
    run_at: datetime


class EmbeddingBenchmarkResultsResponse(BaseModel):
    embedding_benchmark_job_id: int
    status: str
    results: list[EmbeddingBenchmarkResultRow]


class EmbeddingBenchmarkRunSummary(BaseModel):
    embedding_benchmark_job_id: int
    status: str
    models: list[str] | None
    created_at: datetime
    finished_at: datetime | None


def process_reindex(job_id: int) -> None:
    with SessionLocal() as db:
        run_reindex_job(db, job_id)


def process_embedding_benchmark(job_id: int) -> None:
    with SessionLocal() as db:
        run_embedding_benchmark_job(db, job_id)


def _validate_model_name(model: str) -> None:
    if model not in EMBEDDING_MODELS:
        raise AppError(
            "ERR_NOT_FOUND", "Unknown embedding model", {"model": model}, status_code=404
        )


def _validate_benchmark_models(models: list[str] | None) -> None:
    if models is None:
        return
    unknown = [model for model in models if model not in EMBEDDING_MODELS]
    if unknown:
        raise AppError(
            "ERR_VALIDATION",
            "Request validation failed",
            {"models": f"unknown model(s): {unknown}"},
        )


@router.get("/embeddings/models", response_model=list[EmbeddingModelInfo])
def list_models() -> list[EmbeddingModelInfo]:
    return [EmbeddingModelInfo(**item) for item in list_embedding_models()]


@router.get("/embeddings/active", response_model=ActiveEmbeddingModelResponse)
def get_active_model() -> ActiveEmbeddingModelResponse:
    active = embedding_adapter.active
    return ActiveEmbeddingModelResponse(model=active["model"], dimension=active["dimension"])


@router.post("/embeddings/active", response_model=SetActiveEmbeddingModelResponse, status_code=status.HTTP_202_ACCEPTED)
def set_active_model(
    payload: SetActiveEmbeddingModelRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SetActiveEmbeddingModelResponse:
    # Switching embedding models is not a pure state flip the way /models/active is for the
    # chat LLM: every document already indexed under the old model has vectors in a
    # different, now-incompatible space, so a switch always queues a full re-embed of the
    # existing corpus (see src/reindex.py) rather than offering a way to skip it. The model
    # swap itself blocks (same cost as loading any other sentence-transformers model); the
    # corpus-wide re-embed that follows does not, hence 202 plus a job id to poll.
    _validate_model_name(payload.model)
    try:
        active = embedding_adapter.set_active(payload.model)
    except EmbeddingModelNotFoundError as error:
        raise AppError("ERR_NOT_FOUND", str(error), {"model": payload.model}, status_code=404) from error
    except Exception as error:
        raise AppError(
            "ERR_EMBEDDING_MODEL_LOAD_FAILED",
            f"Failed to load embedding model '{payload.model}': {error}",
            {"model": payload.model},
            status_code=500,
        ) from error

    job = ReindexJob(
        status="running",
        model=payload.model,
        total_documents=0,
        completed_documents=0,
        created_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(process_reindex, job.id)
    return SetActiveEmbeddingModelResponse(model=active["model"], dimension=active["dimension"], reindex_job_id=job.id)


@router.get("/embeddings/reindex/status/{reindex_job_id}", response_model=ReindexStatusResponse)
def reindex_status(reindex_job_id: int, db: Session = Depends(get_db)) -> ReindexStatusResponse:
    job = db.get(ReindexJob, reindex_job_id)
    if job is None:
        raise AppError("ERR_NOT_FOUND", "Reindex job not found", {"reindex_job_id": reindex_job_id}, status_code=404)
    progress = f"{job.completed_documents} of {job.total_documents}" if job.total_documents else "starting"
    return ReindexStatusResponse(
        status=job.status, model=job.model, progress=progress, current_document=job.current_document
    )


@router.get("/embeddings/reindex", response_model=list[ReindexRunSummary])
def list_reindex_runs(db: Session = Depends(get_db)) -> list[ReindexRunSummary]:
    jobs = db.query(ReindexJob).order_by(ReindexJob.id.desc()).all()
    return [
        ReindexRunSummary(
            reindex_job_id=job.id,
            status=job.status,
            model=job.model,
            created_at=job.created_at,
            finished_at=job.finished_at,
        )
        for job in jobs
    ]


@router.post(
    "/embeddings/benchmark", response_model=EmbeddingBenchmarkResponse, status_code=status.HTTP_202_ACCEPTED
)
def start_embedding_benchmark(
    payload: EmbeddingBenchmarkRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> EmbeddingBenchmarkResponse:
    _validate_benchmark_models(payload.models)

    job = EmbeddingBenchmarkJob(
        status="running",
        models=payload.models,
        total_runs=0,
        completed_runs=0,
        created_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(process_embedding_benchmark, job.id)
    return EmbeddingBenchmarkResponse(embedding_benchmark_job_id=job.id)


@router.get("/embeddings/benchmark/status/{embedding_benchmark_job_id}", response_model=EmbeddingBenchmarkStatusResponse)
def embedding_benchmark_status(
    embedding_benchmark_job_id: int, db: Session = Depends(get_db)
) -> EmbeddingBenchmarkStatusResponse:
    job = db.get(EmbeddingBenchmarkJob, embedding_benchmark_job_id)
    if job is None:
        raise AppError(
            "ERR_NOT_FOUND",
            "Embedding benchmark job not found",
            {"embedding_benchmark_job_id": embedding_benchmark_job_id},
            status_code=404,
        )
    progress = f"{job.completed_runs} of {job.total_runs}" if job.total_runs else "starting"
    return EmbeddingBenchmarkStatusResponse(status=job.status, progress=progress, current=job.current_model)


@router.get("/embeddings/benchmark/results", response_model=list[EmbeddingBenchmarkRunSummary])
def list_embedding_benchmark_runs(db: Session = Depends(get_db)) -> list[EmbeddingBenchmarkRunSummary]:
    jobs = db.query(EmbeddingBenchmarkJob).order_by(EmbeddingBenchmarkJob.id.desc()).all()
    return [
        EmbeddingBenchmarkRunSummary(
            embedding_benchmark_job_id=job.id,
            status=job.status,
            models=job.models,
            created_at=job.created_at,
            finished_at=job.finished_at,
        )
        for job in jobs
    ]


@router.get(
    "/embeddings/benchmark/results/{embedding_benchmark_job_id}", response_model=EmbeddingBenchmarkResultsResponse
)
def embedding_benchmark_results(
    embedding_benchmark_job_id: int, db: Session = Depends(get_db)
) -> EmbeddingBenchmarkResultsResponse:
    job = db.get(EmbeddingBenchmarkJob, embedding_benchmark_job_id)
    if job is None:
        raise AppError(
            "ERR_NOT_FOUND",
            "Embedding benchmark job not found",
            {"embedding_benchmark_job_id": embedding_benchmark_job_id},
            status_code=404,
        )
    rows = (
        db.query(EmbeddingEvalResult)
        .filter_by(embedding_benchmark_job_id=job.id)
        .order_by(EmbeddingEvalResult.id)
        .all()
    )
    return EmbeddingBenchmarkResultsResponse(
        embedding_benchmark_job_id=job.id,
        status=job.status,
        results=[
            EmbeddingBenchmarkResultRow(
                model=row.model,
                dimension=row.dimension,
                status=row.status,
                detail=row.detail,
                load_s=row.load_s,
                text_label=row.text_label,
                text_count=row.text_count,
                embed_s=row.embed_s,
                texts_per_s=row.texts_per_s,
                peak_mem_mb=row.peak_mem_mb,
                run_at=row.run_at,
            )
            for row in rows
        ],
    )

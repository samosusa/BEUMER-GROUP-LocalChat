from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api.projects import get_project_or_404
from src.db import SessionLocal, get_db
from src.errors import AppError
from src.ingest.embedder import embedding_adapter
from src.llm_adapter import llm_adapter
from src.models.rag_eval_job import RagEvalJob
from src.models.rag_eval_result import RagEvalResult
from src.rag_eval import DEFAULT_DATASET_ID, describe_datasets, list_dataset_ids, run_rag_eval_job, summarize_results

router = APIRouter()


class RagEvalDatasetDocument(BaseModel):
    source: str
    title_hint: str
    question_count: int


class RagEvalDatasetInfo(BaseModel):
    id: str
    documents: list[RagEvalDatasetDocument]
    total_questions: int


class StartRagEvalRequest(BaseModel):
    project_id: int | None = None
    dataset_id: str = DEFAULT_DATASET_ID


class StartRagEvalResponse(BaseModel):
    rag_eval_job_id: int


class RagEvalStatusResponse(BaseModel):
    status: str
    dataset_id: str
    progress: str
    current_question: str | None


class RagEvalRunSummary(BaseModel):
    rag_eval_job_id: int
    status: str
    dataset_id: str
    project_id: int | None
    answer_model: str | None
    embedding_model: str | None
    created_at: datetime
    finished_at: datetime | None


class RagEvalResultRow(BaseModel):
    source: str
    difficulty: str
    question: str
    expected_answer: str
    actual_answer: str | None
    not_found: bool
    retrieval_hit: bool
    judge_verdict: str | None
    judge_detail: str | None
    complexity_tier: str | None
    complexity_score: float | None
    latency_s: float | None
    citations: list[dict[str, Any]] | None
    run_at: datetime


class RagEvalBucketSummary(BaseModel):
    total: int
    retrieval_hit_rate: float | None
    judge_counts: dict[str, int]


class RagEvalSummary(RagEvalBucketSummary):
    by_difficulty: dict[str, RagEvalBucketSummary]


class RagEvalResultsResponse(BaseModel):
    rag_eval_job_id: int
    status: str
    dataset_id: str
    answer_model: str | None
    embedding_model: str | None
    summary: RagEvalSummary
    results: list[RagEvalResultRow]


def process_rag_eval(job_id: int, project_id: int | None, dataset_id: str) -> None:
    with SessionLocal() as db:
        run_rag_eval_job(db, job_id, project_id, dataset_id=dataset_id)


def _validate_dataset_id(dataset_id: str) -> None:
    if dataset_id not in list_dataset_ids():
        raise AppError("ERR_NOT_FOUND", "Unknown RAG eval dataset", {"dataset_id": dataset_id}, status_code=404)


@router.get("/rag-eval/datasets", response_model=list[RagEvalDatasetInfo])
def get_rag_eval_datasets() -> list[RagEvalDatasetInfo]:
    return [RagEvalDatasetInfo(**dataset) for dataset in describe_datasets()]


@router.post("/rag-eval", response_model=StartRagEvalResponse, status_code=status.HTTP_202_ACCEPTED)
def start_rag_eval(
    payload: StartRagEvalRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> StartRagEvalResponse:
    if payload.project_id is not None:
        get_project_or_404(db, payload.project_id)
    _validate_dataset_id(payload.dataset_id)

    active_answer_model = llm_adapter.active
    job = RagEvalJob(
        status="running",
        dataset=payload.dataset_id,
        project_id=payload.project_id,
        answer_model=active_answer_model["model"] if active_answer_model else None,
        embedding_model=embedding_adapter.active["model"],
        total_questions=0,
        completed_questions=0,
        created_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(process_rag_eval, job.id, payload.project_id, payload.dataset_id)
    return StartRagEvalResponse(rag_eval_job_id=job.id)


@router.get("/rag-eval/status/{rag_eval_job_id}", response_model=RagEvalStatusResponse)
def rag_eval_status(rag_eval_job_id: int, db: Session = Depends(get_db)) -> RagEvalStatusResponse:
    job = db.get(RagEvalJob, rag_eval_job_id)
    if job is None:
        raise AppError(
            "ERR_NOT_FOUND", "RAG eval job not found", {"rag_eval_job_id": rag_eval_job_id}, status_code=404
        )
    progress = f"{job.completed_questions} of {job.total_questions}" if job.total_questions else "starting"
    return RagEvalStatusResponse(
        status=job.status, dataset_id=job.dataset, progress=progress, current_question=job.current_question
    )


@router.get("/rag-eval/results", response_model=list[RagEvalRunSummary])
def list_rag_eval_runs(db: Session = Depends(get_db)) -> list[RagEvalRunSummary]:
    jobs = db.query(RagEvalJob).order_by(RagEvalJob.id.desc()).all()
    return [
        RagEvalRunSummary(
            rag_eval_job_id=job.id,
            status=job.status,
            dataset_id=job.dataset,
            project_id=job.project_id,
            answer_model=job.answer_model,
            embedding_model=job.embedding_model,
            created_at=job.created_at,
            finished_at=job.finished_at,
        )
        for job in jobs
    ]


@router.get("/rag-eval/results/{rag_eval_job_id}", response_model=RagEvalResultsResponse)
def rag_eval_results(rag_eval_job_id: int, db: Session = Depends(get_db)) -> RagEvalResultsResponse:
    job = db.get(RagEvalJob, rag_eval_job_id)
    if job is None:
        raise AppError(
            "ERR_NOT_FOUND", "RAG eval job not found", {"rag_eval_job_id": rag_eval_job_id}, status_code=404
        )
    rows = (
        db.query(RagEvalResult)
        .filter_by(rag_eval_job_id=job.id)
        .order_by(RagEvalResult.id)
        .all()
    )
    return RagEvalResultsResponse(
        rag_eval_job_id=job.id,
        status=job.status,
        dataset_id=job.dataset,
        answer_model=job.answer_model,
        embedding_model=job.embedding_model,
        summary=RagEvalSummary(**summarize_results(rows)),
        results=[
            RagEvalResultRow(
                source=row.source,
                difficulty=row.difficulty,
                question=row.question,
                expected_answer=row.expected_answer,
                actual_answer=row.actual_answer,
                not_found=row.not_found,
                retrieval_hit=row.retrieval_hit,
                judge_verdict=row.judge_verdict,
                judge_detail=row.judge_detail,
                complexity_tier=row.complexity_tier,
                complexity_score=row.complexity_score,
                latency_s=row.latency_s,
                citations=row.citations,
                run_at=row.run_at,
            )
            for row in rows
        ],
    )

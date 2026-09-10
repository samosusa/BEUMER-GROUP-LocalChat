from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.benchmark import run_benchmark_job
from src.db import SessionLocal, get_db
from src.errors import AppError
from src.llm_adapter import VALID_DEVICES, gpu_available, list_model_files
from src.models.benchmark_job import BenchmarkJob
from src.models.eval_result import EvalResult

router = APIRouter()


class BenchmarkRequest(BaseModel):
    devices: list[str]
    models: list[str] | None = None


class BenchmarkResponse(BaseModel):
    benchmark_job_id: int


class BenchmarkStatusResponse(BaseModel):
    status: str
    progress: str
    current: str | None


class BenchmarkResultRow(BaseModel):
    model: str
    device: str
    device_name: str | None
    status: str
    detail: str | None
    load_s: float | None
    ttft_s: float | None
    gen_tokens: int | None
    tok_s: float | None
    total_s: float | None
    peak_mem_mb: float | None
    peak_vram_mb: float | None
    question: str | None
    prompt_label: str | None
    complexity_tier: str | None
    complexity_score: float | None
    run_at: datetime


class BenchmarkResultsResponse(BaseModel):
    benchmark_job_id: int
    status: str
    results: list[BenchmarkResultRow]


class BenchmarkRunSummary(BaseModel):
    benchmark_job_id: int
    status: str
    devices: list[str]
    models: list[str] | None
    created_at: datetime
    finished_at: datetime | None


def process_benchmark(job_id: int) -> None:
    with SessionLocal() as db:
        run_benchmark_job(db, job_id)


def _validate_devices(devices: list[str]) -> None:
    if not devices:
        raise AppError("ERR_VALIDATION", "Request validation failed", {"devices": "is required"})
    unknown = [device for device in devices if device not in VALID_DEVICES]
    if unknown:
        raise AppError(
            "ERR_VALIDATION",
            "Request validation failed",
            {"devices": f"must only contain {list(VALID_DEVICES)}, got {unknown}"},
        )
    if "gpu" in devices and not gpu_available():
        raise AppError(
            "ERR_GPU_UNAVAILABLE",
            "devices includes \"gpu\" but this build of llama-cpp-python has no CUDA/GPU "
            "offload support installed. Install the CUDA-enabled wheel, or benchmark cpu only.",
            {"devices": devices},
            status_code=422,
        )


def _validate_models(models: list[str] | None) -> None:
    if models is None:
        return
    available = {item["name"] for item in list_model_files()}
    unknown = [model for model in models if model not in available]
    if unknown:
        raise AppError(
            "ERR_VALIDATION",
            "Request validation failed",
            {"models": f"unknown model(s): {unknown}"},
        )


@router.post("/benchmark", response_model=BenchmarkResponse, status_code=status.HTTP_202_ACCEPTED)
def start_benchmark(
    payload: BenchmarkRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> BenchmarkResponse:
    _validate_devices(payload.devices)
    _validate_models(payload.models)

    job = BenchmarkJob(
        status="running",
        devices=payload.devices,
        models=payload.models,
        total_runs=0,
        completed_runs=0,
        created_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(process_benchmark, job.id)
    return BenchmarkResponse(benchmark_job_id=job.id)


@router.get("/benchmark/status/{benchmark_job_id}", response_model=BenchmarkStatusResponse)
def benchmark_status(benchmark_job_id: int, db: Session = Depends(get_db)) -> BenchmarkStatusResponse:
    job = db.get(BenchmarkJob, benchmark_job_id)
    if job is None:
        raise AppError(
            "ERR_NOT_FOUND", "Benchmark job not found", {"benchmark_job_id": benchmark_job_id}, status_code=404
        )
    current = f"{job.current_model} on {job.current_device}" if job.current_model else None
    progress = f"{job.completed_runs} of {job.total_runs}" if job.total_runs else "starting"
    return BenchmarkStatusResponse(status=job.status, progress=progress, current=current)


@router.get("/benchmark/results", response_model=list[BenchmarkRunSummary])
def list_benchmark_runs(db: Session = Depends(get_db)) -> list[BenchmarkRunSummary]:
    jobs = db.query(BenchmarkJob).order_by(BenchmarkJob.id.desc()).all()
    return [
        BenchmarkRunSummary(
            benchmark_job_id=job.id,
            status=job.status,
            devices=job.devices,
            models=job.models,
            created_at=job.created_at,
            finished_at=job.finished_at,
        )
        for job in jobs
    ]


@router.get("/benchmark/results/{benchmark_job_id}", response_model=BenchmarkResultsResponse)
def benchmark_results(benchmark_job_id: int, db: Session = Depends(get_db)) -> BenchmarkResultsResponse:
    job = db.get(BenchmarkJob, benchmark_job_id)
    if job is None:
        raise AppError(
            "ERR_NOT_FOUND", "Benchmark job not found", {"benchmark_job_id": benchmark_job_id}, status_code=404
        )
    rows = db.query(EvalResult).filter_by(benchmark_job_id=job.id).order_by(EvalResult.id).all()
    return BenchmarkResultsResponse(
        benchmark_job_id=job.id,
        status=job.status,
        results=[
            BenchmarkResultRow(
                model=row.model,
                device=row.device,
                device_name=row.device_name,
                status=row.status,
                detail=row.detail,
                load_s=row.load_s,
                ttft_s=row.ttft_s,
                gen_tokens=row.gen_tokens,
                tok_s=row.tok_s,
                total_s=row.total_s,
                peak_mem_mb=row.peak_mem_mb,
                peak_vram_mb=row.peak_vram_mb,
                question=row.question,
                prompt_label=row.prompt_label,
                complexity_tier=row.complexity_tier,
                complexity_score=row.complexity_score,
                run_at=row.run_at,
            )
            for row in rows
        ],
    )

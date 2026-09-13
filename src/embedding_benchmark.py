"""Background benchmark harness for embedding models, same job-row-updated-as-it-goes shape
as src/benchmark.py (the LLM benchmark), timing sentence-transformers model load + encoding
on CPU instead of GGUF load + generation. No device axis: every embedding model this app
offers (see src/ingest/embedder.py) runs on CPU only, matching how the embedder is already
hardcoded today.

Each row loads its own EmbeddingModel instance directly rather than going through the shared
embedding_adapter, mirroring how src/benchmark.py's run_one loads its own Llama instance
directly - so a benchmark run never disturbs whatever model /embeddings/active currently has
loaded for live ingestion/retrieval.
"""

from __future__ import annotations

import gc
import time
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from src.ingest.embedder import EMBEDDING_MODELS, EmbeddingModel
from src.models.embedding_benchmark_job import EmbeddingBenchmarkJob
from src.models.embedding_eval_result import EmbeddingEvalResult

# One tier per representative chunk size, so a run reports throughput broken down by how much
# text a single embed() call handles - a model that's fast on a handful of short strings may
# not stay fast once the batch looks like a real chunk of documentation.
EMBEDDING_BENCHMARK_TEXTS = (
    {
        "label": "short",
        "texts": [
            "Emergency stop pull-cords must be tested every shift.",
            "The drive motor cuts power within 500ms of activation.",
            "Log the test in the shift handover sheet.",
            "Belt speed is monitored continuously by the PLC.",
            "Replace worn idler rollers before they seize.",
        ],
    },
    {
        "label": "medium",
        "texts": [
            (
                "Pull the cord at the midpoint of each belt section and confirm the drive "
                "motor cuts power within 500ms. If the motor does not stop in time, tag the "
                "section out of service and notify the shift supervisor before any further "
                "material is loaded onto the line."
            )
        ]
        * 5,
    },
    {
        "label": "long",
        "texts": [
            (
                "Preventive maintenance on the sortation conveyor covers three areas: drive "
                "train, belt tracking, and safety interlocks. Drive train checks include "
                "inspecting the gearbox oil level, verifying coupling alignment, and listening "
                "for bearing noise under load. Belt tracking checks confirm the belt runs "
                "centered on all idlers across the full length of the section, adjusting "
                "training idlers in small increments rather than large corrections. Safety "
                "interlock checks exercise every pull-cord and light curtain on the section, "
                "confirming each one cuts drive power and cannot be bypassed by holding the "
                "reset button. Any finding outside tolerance is logged with photo evidence and "
                "escalated to engineering before the section is returned to service."
            )
        ]
        * 5,
    },
)


@dataclass
class EmbeddingBenchmarkRow:
    model: str
    dimension: int | None
    text_label: str
    text_count: int
    status: str = "pending"
    detail: str | None = None
    load_s: float | None = None
    embed_s: float | None = None
    texts_per_s: float | None = None
    total_s: float | None = None
    peak_mem_mb: float | None = None


def resolve_models(model_names: list[str] | None) -> list[str]:
    all_models = list(EMBEDDING_MODELS)
    if not model_names:
        return all_models
    wanted = set(model_names)
    return [name for name in all_models if name in wanted]


def run_one(model_name: str, text_spec: dict) -> EmbeddingBenchmarkRow:
    spec = EMBEDDING_MODELS[model_name]
    row = EmbeddingBenchmarkRow(
        model=model_name,
        dimension=spec.dimension,
        text_label=text_spec["label"],
        text_count=len(text_spec["texts"]),
    )

    import psutil

    proc = psutil.Process()
    model: EmbeddingModel | None = None
    try:
        t0 = time.perf_counter()
        model = EmbeddingModel(model_name)
        model.load()
        row.load_s = time.perf_counter() - t0

        t1 = time.perf_counter()
        vectors = model.embed(text_spec["texts"])
        row.embed_s = time.perf_counter() - t1

        if len(vectors) != row.text_count or (vectors and len(vectors[0]) != spec.dimension):
            row.status = "error"
            row.detail = "embedder returned an unexpected vector count or dimension"
            return row

        row.texts_per_s = (row.text_count / row.embed_s) if row.embed_s else None
        row.total_s = row.load_s + row.embed_s
        row.peak_mem_mb = round(proc.memory_info().rss / (1024 * 1024), 1)
        row.status = "ok"
    except Exception as exc:  # a single model failing shouldn't abort the whole job
        row.status = "error"
        row.detail = str(exc)
    finally:
        if model is not None:
            model.unload()
        gc.collect()

    return row


def _get_job(db: Session, job_id: int) -> EmbeddingBenchmarkJob:
    job = db.get(EmbeddingBenchmarkJob, job_id)
    if job is None:
        raise ValueError(f"Embedding benchmark job {job_id} not found")
    return job


def _mark_failed(db: Session, job_id: int, error: Exception) -> None:
    db.rollback()
    job = db.get(EmbeddingBenchmarkJob, job_id)
    if job is not None:
        job.status = "failed"
        job.error = str(error)
        job.finished_at = datetime.utcnow()
        db.commit()


def _store_row(db: Session, job: EmbeddingBenchmarkJob, row: EmbeddingBenchmarkRow) -> None:
    db.add(
        EmbeddingEvalResult(
            embedding_benchmark_job_id=job.id,
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
            run_at=datetime.utcnow(),
        )
    )
    job.completed_runs += 1
    db.commit()


def run_embedding_benchmark_job(db: Session, job_id: int) -> None:
    job = _get_job(db, job_id)
    try:
        model_names = resolve_models(job.models)
        if not model_names:
            raise ValueError("No matching embedding models found")

        job.total_runs = len(model_names) * len(EMBEDDING_BENCHMARK_TEXTS)
        job.completed_runs = 0
        db.commit()

        for model_name in model_names:
            for text_spec in EMBEDDING_BENCHMARK_TEXTS:
                job.current_model = model_name
                db.commit()

                row = run_one(model_name, text_spec)
                _store_row(db, job, row)

        job.status = "completed"
        job.current_model = None
        job.finished_at = datetime.utcnow()
        db.commit()
    except Exception as error:
        _mark_failed(db, job_id, error)
        raise

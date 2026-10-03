"""Capacity sweep for the FAISS-backed vector store: how insertion speed, disk usage, and
retrieval latency change as the number of ingested *documents* grows.

src/ingest/vector_store.py keeps one FAISS index file per document rather than one shared
index, and src/retriever.py's retrieve() answers every query by globbing every one of those
files, loading each with faiss.read_index, searching it, and merge-sorting the results in
Python. That makes document *count* - not just total chunk count - the axis most likely to
make things slow. This module drives the real pipeline (src/ingest/pipeline.run_pipeline) to
measure where.

Two callers share `run_capacity_sweep()` below:
  - POST /vector-capacity/benchmark (src/api/vector_capacity.py), a background job polled the
    same way as the other two benchmarks, via `run_vector_capacity_job()`.
  - scripts/vector_capacity_sweep.py, a standalone CLI for larger/manual sweeps.

Everything the sweep touches - documents, chunks, FAISS index files - lives in an isolated
SQLite database and vector directory created just for the run, never the app's own
data/app.db / data/vectors/. That isolation is not just about keeping synthetic documents out
of a real corpus (though it does that too): a background job sharing those with real traffic
could not safely fake its embeddings at all, because mutating `os.environ` or monkeypatching
`src.retriever.embed_query` for the run's duration would corrupt any real ingestion or chat
query a user makes while the job is in flight. Passing a fake embedder explicitly to
`run_pipeline()` and `retrieve()` - both accept one - means the sweep never touches global
state, so it is safe to run alongside real traffic in the same process.

Embeddings are fake: a local RNG produces random unit vectors sized to the active embedding
model's configured dimension, instead of loading sentence-transformers. That keeps a sweep of
thousands of documents from being dominated by embedding-model latency, and lets it run
without the real model's weights present at all.
"""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterator

import numpy as np
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.db import Base
from src.ingest.embedder import embedding_adapter
from src.ingest.pipeline import run_pipeline
from src.ingest.vector_store import FaissVectorStore
from src.models.ingestion_job import IngestionJob
from src.models.project import Project  # noqa: F401 - registers `projects`; Document FKs into it
from src.models.vector_capacity_job import VectorCapacityJob
from src.models.vector_capacity_result import VectorCapacityResult
from src.retriever import retrieve

ROOT = Path(__file__).resolve().parent.parent
CAPACITY_RUNS_DIR = ROOT / "data" / "capacity_runs"

DEFAULT_STEPS: tuple[int, ...] = (100, 500, 1000, 2500, 5000)
WORDS_PER_DOC = 1000
QUERIES_PER_STEP = 5
QUERY_TOP_K = 5


def make_fake_embedder(dimension: int, rng: np.random.Generator):
    """Random unit vectors at the real embedding model's dimension - fast, and still passes
    retrieve()'s index.d != query_vector.shape[1] check, unlike an arbitrary fixed size."""

    def fake_embed(texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = rng.standard_normal((len(texts), dimension)).astype("float32")
        vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors.tolist()

    return fake_embed


def make_synthetic_text(word_count: int, rng: np.random.Generator) -> str:
    vocabulary = [f"token{n}" for n in range(200)]
    words = rng.choice(vocabulary, size=word_count)
    # A heading gives chunk_file's section-tracking something to find, closer to a real
    # document than one endless unsectioned paragraph.
    return "# Synthetic Capacity Test Document\n" + " ".join(words)


@dataclass
class CapacityStepResult:
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


def run_capacity_sweep(
    out_dir: Path,
    steps: tuple[int, ...] = DEFAULT_STEPS,
    words_per_doc: int = WORDS_PER_DOC,
    queries_per_step: int = QUERIES_PER_STEP,
    query_top_k: int = QUERY_TOP_K,
    seed: int = 0,
) -> Iterator[CapacityStepResult]:
    """Inserts documents up to each cumulative count in `steps`, yielding one
    `CapacityStepResult` per checkpoint as it is reached. Creates its own SQLite database and
    vector directory under `out_dir`; the caller decides whether `out_dir` survives the run.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    db_path = out_dir / "capacity.db"
    vector_dir = out_dir / "vectors"
    vector_dir.mkdir(parents=True, exist_ok=True)

    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    try:
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

        dimension = embedding_adapter.active["dimension"]
        rng = np.random.default_rng(seed)
        fake_embed = make_fake_embedder(dimension, rng)

        doc_path = out_dir / "synthetic_doc.txt"
        doc_path.write_text(make_synthetic_text(words_per_doc, rng), encoding="utf-8")

        import psutil

        process = psutil.Process()

        inserted = 0
        total_chunks = 0
        for target in sorted(set(steps)):
            to_insert = target - inserted
            if to_insert <= 0:
                continue

            t0 = time.perf_counter()
            for _ in range(to_insert):
                with session_factory() as db:
                    job = IngestionJob(
                        status="running", offset=0, total_chunks=0, created_at=datetime.utcnow()
                    )
                    db.add(job)
                    db.commit()
                    db.refresh(job)
                    run_pipeline(
                        db,
                        job.id,
                        f"capacity-doc-{inserted + 1}",
                        str(doc_path),
                        embedder=fake_embed,
                        vector_store=FaissVectorStore(vector_dir),
                    )
                    total_chunks += job.total_chunks
                inserted += 1
            step_s = time.perf_counter() - t0

            vector_files = list(vector_dir.glob("*.index"))
            vector_dir_mb = sum(f.stat().st_size for f in vector_files) / (1024 * 1024)
            db_size_mb = db_path.stat().st_size / (1024 * 1024)
            rss_mb = process.memory_info().rss / (1024 * 1024)

            latencies_ms: list[float] = []
            hits: list[int] = []
            for i in range(queries_per_step):
                with session_factory() as db:
                    t1 = time.perf_counter()
                    results = retrieve(
                        f"sample capacity query {i}",
                        db,
                        top_k=query_top_k,
                        vector_dir=vector_dir,
                        embed_fn=fake_embed,
                    )
                    latencies_ms.append((time.perf_counter() - t1) * 1000)
                    hits.append(len(results))

            yield CapacityStepResult(
                doc_count=inserted,
                chunk_count=total_chunks,
                step_docs=to_insert,
                step_s=step_s,
                docs_per_s=(to_insert / step_s) if step_s else None,
                vector_dir_mb=vector_dir_mb,
                vector_file_count=len(vector_files),
                db_size_mb=db_size_mb,
                rss_mb=rss_mb,
                query_count=len(latencies_ms),
                query_latency_ms_mean=(sum(latencies_ms) / len(latencies_ms)) if latencies_ms else None,
                query_latency_ms_min=min(latencies_ms) if latencies_ms else None,
                query_latency_ms_max=max(latencies_ms) if latencies_ms else None,
                query_hits_mean=(sum(hits) / len(hits)) if hits else None,
            )
    finally:
        engine.dispose()


def _get_job(db: Session, job_id: int) -> VectorCapacityJob:
    job = db.get(VectorCapacityJob, job_id)
    if job is None:
        raise ValueError(f"Vector capacity job {job_id} not found")
    return job


def _mark_failed(db: Session, job_id: int, error: Exception) -> None:
    db.rollback()
    job = db.get(VectorCapacityJob, job_id)
    if job is not None:
        job.status = "failed"
        job.error = str(error)
        job.finished_at = datetime.utcnow()
        db.commit()


def run_vector_capacity_job(db: Session, job_id: int) -> None:
    job = _get_job(db, job_id)
    out_dir = CAPACITY_RUNS_DIR / f"job-{job_id}"
    sweep = run_capacity_sweep(out_dir, steps=tuple(job.steps))
    try:
        job.total_steps = len(job.steps)
        job.completed_steps = 0
        db.commit()

        for result in sweep:
            job.current_doc_count = result.doc_count
            db.add(
                VectorCapacityResult(
                    vector_capacity_job_id=job.id,
                    doc_count=result.doc_count,
                    chunk_count=result.chunk_count,
                    step_docs=result.step_docs,
                    step_s=result.step_s,
                    docs_per_s=result.docs_per_s,
                    vector_dir_mb=result.vector_dir_mb,
                    vector_file_count=result.vector_file_count,
                    db_size_mb=result.db_size_mb,
                    rss_mb=result.rss_mb,
                    query_count=result.query_count,
                    query_latency_ms_mean=result.query_latency_ms_mean,
                    query_latency_ms_min=result.query_latency_ms_min,
                    query_latency_ms_max=result.query_latency_ms_max,
                    query_hits_mean=result.query_hits_mean,
                    run_at=datetime.utcnow(),
                )
            )
            job.completed_steps += 1
            db.commit()

        job.status = "completed"
        job.current_doc_count = None
        job.finished_at = datetime.utcnow()
        db.commit()
    except Exception as error:
        _mark_failed(db, job_id, error)
        raise
    finally:
        # Closing the generator (a no-op if it already ran to completion) disposes its
        # isolated engine deterministically via the `finally` in run_capacity_sweep, which
        # has to happen before rmtree or Windows refuses to delete the still-open db file.
        sweep.close()
        # Only the VectorCapacityResult rows above are meant to outlive the run - the
        # synthetic documents, chunks and FAISS files that produced them are throwaway by
        # design (see the module docstring), unlike scripts/vector_capacity_sweep.py's CLI
        # runs, which keep theirs under data/capacity_runs/<timestamp>/ for inspection.
        shutil.rmtree(out_dir, ignore_errors=True)

"""Capacity sweep for the FAISS-backed vector store: how insertion speed, disk usage, and
retrieval latency change as the number of ingested *documents* grows.

src/ingest/vector_store.py keeps one FAISS index file per document (data/vectors/<doc_id>.index)
rather than one shared index, and src/retriever.py's retrieve() answers every query by globbing
every one of those files, loading each with faiss.read_index, searching it, and merge-sorting
the results in Python. That design makes document *count* - not just total chunk count - the
axis most likely to make things slow, and nothing in the codebase measures where that happens.
This script drives the real pipeline (src/ingest/pipeline.run_pipeline) to find out.

Embeddings are fake: a local RNG produces random unit vectors sized to the active embedding
model's configured dimension, instead of loading sentence-transformers. That keeps a sweep of
thousands of documents from being dominated by embedding-model latency, and lets it run without
the real model's weights present at all. The dimension still has to match what's configured
(src/ingest/embedder.py's active model), because retrieve() silently skips any FAISS index whose
dimension doesn't match the query vector's - a mismatch here wouldn't error, it would just make
every later retrieval measurement look like zero hits for the wrong reason.

Every run gets its own throwaway SQLite database and vector directory under
data/capacity_runs/<timestamp>/ (mirroring scripts/demo_workflow.py and tests/conftest.py), so
this never touches the real data/app.db or data/vectors/. Results are appended to a CSV as each
step finishes, so killing a long sweep partway through still leaves usable data on disk.

Usage:
    python scripts/vector_capacity_sweep.py
    python scripts/vector_capacity_sweep.py --steps 1000 5000 20000 --queries-per-step 10
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np

CSV_FIELDS = (
    "doc_count",
    "chunk_count",
    "step_docs",
    "step_s",
    "docs_per_s",
    "chunks_per_s",
    "vector_dir_mb",
    "vector_file_count",
    "db_size_mb",
    "rss_mb",
    "query_count",
    "query_latency_ms_mean",
    "query_latency_ms_min",
    "query_latency_ms_max",
    "query_hits_mean",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--steps", type=int, nargs="+", default=[100, 500, 1000, 2500, 5000],
        help="Cumulative document counts to measure at (default: 100 500 1000 2500 5000).",
    )
    parser.add_argument(
        "--words-per-doc", type=int, default=1000,
        help="Word count of each synthetic document; controls chunks-per-document via "
             "src/ingest/chunker.py's default windowing (default: 1000, ~3 chunks/doc).",
    )
    parser.add_argument(
        "--queries-per-step", type=int, default=5,
        help="Retrieval queries sampled after each step to measure latency (default: 5).",
    )
    parser.add_argument("--query-top-k", type=int, default=5)
    parser.add_argument(
        "--out-dir", type=Path, default=None,
        help="Where to put this run's db/vectors/CSV. Defaults to data/capacity_runs/<timestamp>/.",
    )
    parser.add_argument("--seed", type=int, default=0)
    return parser.parse_args()


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


def format_row(row: dict) -> str:
    return (
        f"[{row['doc_count']:>6} docs] insert {row['step_s']:>7.2f}s ({row['docs_per_s']:>8} docs/s) | "
        f"vectors {row['vector_dir_mb']:>8.2f} MB / {row['vector_file_count']:>6} files | "
        f"db {row['db_size_mb']:>7.2f} MB | rss {row['rss_mb']:>7.1f} MB | "
        f"query {row['query_latency_ms_mean']:>7} ms avg, {row['query_hits_mean']:>4} hits avg"
    )


def main() -> int:
    args = parse_args()
    steps = sorted(set(args.steps))
    if not steps or any(step <= 0 for step in steps):
        print("--steps must be one or more positive integers.", file=sys.stderr)
        return 2

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = args.out_dir or (ROOT / "data" / "capacity_runs" / run_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    db_path = out_dir / "capacity.db"
    vector_dir = out_dir / "vectors"
    vector_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "results.csv"

    # Must happen before src.db (or anything importing it) is ever imported: its engine binds
    # to LOCALCHAT_DATABASE_URL at module import time, same ordering constraint documented in
    # tests/conftest.py.
    os.environ["LOCALCHAT_DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["LOCALCHAT_VECTOR_DIR"] = str(vector_dir)

    from src.db import Base, SessionLocal, engine
    from src.ingest.embedder import embedding_adapter
    from src.ingest.pipeline import run_pipeline
    from src.models.ingestion_job import IngestionJob
    from src.models.project import Project  # noqa: F401 - registers `projects` on Base.metadata; Document FKs into it
    import src.retriever as retriever_module

    Base.metadata.create_all(engine)

    dimension = embedding_adapter.active["dimension"]
    rng = np.random.default_rng(args.seed)
    fake_embed = make_fake_embedder(dimension, rng)
    # retrieve() calls the module-level name it imported, so rebinding it here is what makes
    # query embedding fake too - without ever loading the real sentence-transformers model.
    retriever_module.embed_query = fake_embed

    doc_path = out_dir / "synthetic_doc.txt"
    doc_path.write_text(make_synthetic_text(args.words_per_doc, rng), encoding="utf-8")

    print(f"Run: {run_id}")
    print(f"Embedding dimension (fake vectors): {dimension}")
    print(f"Database: {db_path}")
    print(f"Vectors: {vector_dir}")
    print(f"Steps: {steps}")
    print(f"Results CSV: {csv_path}\n")

    inserted = 0
    total_chunks = 0
    rows: list[dict] = []

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()

        for target in steps:
            to_insert = target - inserted
            if to_insert <= 0:
                continue

            chunks_before = total_chunks
            t0 = time.perf_counter()
            for _ in range(to_insert):
                with SessionLocal() as db:
                    job = IngestionJob(status="running", offset=0, total_chunks=0, created_at=datetime.utcnow())
                    db.add(job)
                    db.commit()
                    db.refresh(job)
                    run_pipeline(db, job.id, f"capacity-doc-{inserted + 1}", str(doc_path), embedder=fake_embed)
                    total_chunks += job.total_chunks
                inserted += 1
            step_s = time.perf_counter() - t0

            vector_files = list(vector_dir.glob("*.index"))
            vector_mb = sum(f.stat().st_size for f in vector_files) / (1024 * 1024)
            db_mb = db_path.stat().st_size / (1024 * 1024)

            import psutil

            rss_mb = psutil.Process().memory_info().rss / (1024 * 1024)

            latencies_ms: list[float] = []
            hits: list[int] = []
            for i in range(args.queries_per_step):
                with SessionLocal() as db:
                    t1 = time.perf_counter()
                    results = retriever_module.retrieve(
                        f"sample capacity query {i}", db, top_k=args.query_top_k
                    )
                    latencies_ms.append((time.perf_counter() - t1) * 1000)
                    hits.append(len(results))

            row = {
                "doc_count": inserted,
                "chunk_count": total_chunks,
                "step_docs": to_insert,
                "step_s": round(step_s, 3),
                "docs_per_s": round(to_insert / step_s, 2) if step_s else "",
                "chunks_per_s": round((total_chunks - chunks_before) / step_s, 2) if step_s else "",
                "vector_dir_mb": round(vector_mb, 2),
                "vector_file_count": len(vector_files),
                "db_size_mb": round(db_mb, 2),
                "rss_mb": round(rss_mb, 1),
                "query_count": len(latencies_ms),
                "query_latency_ms_mean": round(sum(latencies_ms) / len(latencies_ms), 2) if latencies_ms else "",
                "query_latency_ms_min": round(min(latencies_ms), 2) if latencies_ms else "",
                "query_latency_ms_max": round(max(latencies_ms), 2) if latencies_ms else "",
                "query_hits_mean": round(sum(hits) / len(hits), 2) if hits else "",
            }
            writer.writerow(row)
            handle.flush()
            rows.append(row)
            print(format_row(row))

    print(f"\nWrote {csv_path}")

    expected_hits = min(args.query_top_k, total_chunks)
    if rows and rows[-1]["query_hits_mean"] not in ("", expected_hits):
        print(
            f"\nWARNING: expected ~{expected_hits} hits/query at {inserted} documents but got "
            f"{rows[-1]['query_hits_mean']}. Retrieval may be silently finding nothing - check "
            "that the fake embedding dimension matches the active model's configured dimension.",
            file=sys.stderr,
        )

    if len(rows) >= 2:
        first, last = rows[0], rows[-1]
        print(
            f"\nFrom {first['doc_count']} to {last['doc_count']} documents: "
            f"insertion throughput {first['docs_per_s']} -> {last['docs_per_s']} docs/s, "
            f"retrieval latency {first['query_latency_ms_mean']} -> {last['query_latency_ms_mean']} ms avg."
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())

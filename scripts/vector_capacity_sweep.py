"""Capacity sweep for the FAISS-backed vector store: how insertion speed, disk usage, and
retrieval latency change as the number of ingested *documents* grows.

This is the CLI entry point; the sweep itself lives in src/vector_capacity_benchmark.py,
shared with the background job behind Settings > Benchmarks in the app (POST
/vector-capacity/benchmark) - see that module's docstring for the full rationale (fake,
correctly-dimensioned embeddings; an isolated database and vector directory per run). The one
difference here: a CLI run's database, vector files and synthetic source document are kept on
disk under data/capacity_runs/<timestamp>/ for inspection, where the background job deletes
them once its summary rows are recorded.

Usage:
    python scripts/vector_capacity_sweep.py
    python scripts/vector_capacity_sweep.py --steps 1000 5000 20000 --queries-per-step 10
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.vector_capacity_benchmark import (  # noqa: E402
    DEFAULT_STEPS,
    QUERIES_PER_STEP,
    QUERY_TOP_K,
    WORDS_PER_DOC,
    CapacityStepResult,
    run_capacity_sweep,
)

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
        "--steps", type=int, nargs="+", default=list(DEFAULT_STEPS),
        help=f"Cumulative document counts to measure at (default: {' '.join(map(str, DEFAULT_STEPS))}).",
    )
    parser.add_argument(
        "--words-per-doc", type=int, default=WORDS_PER_DOC,
        help="Word count of each synthetic document; controls chunks-per-document via "
             f"src/ingest/chunker.py's default windowing (default: {WORDS_PER_DOC}).",
    )
    parser.add_argument(
        "--queries-per-step", type=int, default=QUERIES_PER_STEP,
        help=f"Retrieval queries sampled after each step to measure latency (default: {QUERIES_PER_STEP}).",
    )
    parser.add_argument("--query-top-k", type=int, default=QUERY_TOP_K)
    parser.add_argument(
        "--out-dir", type=Path, default=None,
        help="Where to put this run's db/vectors/CSV. Defaults to data/capacity_runs/<timestamp>/.",
    )
    parser.add_argument("--seed", type=int, default=0)
    return parser.parse_args()


def row_for(result: CapacityStepResult) -> dict:
    return {
        "doc_count": result.doc_count,
        "chunk_count": result.chunk_count,
        "step_docs": result.step_docs,
        "step_s": round(result.step_s, 3),
        "docs_per_s": round(result.docs_per_s, 2) if result.docs_per_s is not None else "",
        "chunks_per_s": round(result.chunk_count / result.step_s, 2) if result.step_s else "",
        "vector_dir_mb": round(result.vector_dir_mb, 2),
        "vector_file_count": result.vector_file_count,
        "db_size_mb": round(result.db_size_mb, 2),
        "rss_mb": round(result.rss_mb, 1),
        "query_count": result.query_count,
        "query_latency_ms_mean": round(result.query_latency_ms_mean, 2) if result.query_latency_ms_mean is not None else "",
        "query_latency_ms_min": round(result.query_latency_ms_min, 2) if result.query_latency_ms_min is not None else "",
        "query_latency_ms_max": round(result.query_latency_ms_max, 2) if result.query_latency_ms_max is not None else "",
        "query_hits_mean": round(result.query_hits_mean, 2) if result.query_hits_mean is not None else "",
    }


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
    csv_path = out_dir / "results.csv"

    print(f"Run: {run_id}")
    print(f"Steps: {steps}")
    print(f"Output: {out_dir}\n")

    rows: list[dict] = []
    out_dir.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()

        for result in run_capacity_sweep(
            out_dir,
            steps=tuple(steps),
            words_per_doc=args.words_per_doc,
            queries_per_step=args.queries_per_step,
            query_top_k=args.query_top_k,
            seed=args.seed,
        ):
            row = row_for(result)
            writer.writerow(row)
            handle.flush()
            rows.append(row)
            print(format_row(row))

    print(f"\nWrote {csv_path}")

    expected_hits = min(args.query_top_k, rows[-1]["chunk_count"]) if rows else 0
    if rows and rows[-1]["query_hits_mean"] not in ("", expected_hits):
        print(
            f"\nWARNING: expected ~{expected_hits} hits/query at {rows[-1]['doc_count']} documents "
            f"but got {rows[-1]['query_hits_mean']}. Retrieval may be silently finding nothing - "
            "check that the fake embedding dimension matches the active model's configured dimension.",
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

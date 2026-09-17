"""Seeds benchmark history from a checked-in CSV, one machine at a time.

A fresh `data/app.db` has no benchmark_jobs and no eval_results, so the Settings screen's
benchmark charts are empty until someone runs a benchmark themselves - which can take a long
time on a laptop with no GPU. `data/exports/merged_benchmarks.csv` (see
scripts/export_benchmark_csv.py's docstring for the shape a merge like this comes from) is
two people's real runs, committed to the repo so everyone starts with something to look at.

Gated per machine's hardware, not on the table being empty. A developer who already has their
OWN benchmark history in `data/app.db` - which is the common case, not the exception, since
running a benchmark is the first thing this screen invites you to do - has a non-empty table
before this ever runs, and "only seed an empty table" would never add anyone else's machine
for them. Checking `eval_results.device_name` per CSV machine group instead means each
machine's rows go in exactly once: already-present hardware is skipped (no duplicate jobs
inflating "latest run" or the trend charts), and a machine whose hardware has never appeared
gets imported, however many other machines' data already exists.

The CSV is already a 3-prompt-sweep summary per model/device (it carries `samples` and
`tok_s_min`/`tok_s_max` instead of one row per prompt), not the per-prompt shape
src/benchmark.py writes - so imported rows leave prompt_label/complexity_tier/question as
None rather than inventing a prompt that was never asked.
"""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from src.models.benchmark_job import BenchmarkJob
from src.models.eval_result import EvalResult

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = ROOT / "data" / "exports" / "merged_benchmarks.csv"

IMPORT_DETAIL = (
    "Imported from data/exports/merged_benchmarks.csv; no measurement recorded for this row."
)


def _machine_label(row: dict[str, str]) -> str:
    """The CSV's `machine` column, or a label derived from `source_file` when it's blank.

    `results_samo.csv`'s rows carry no `machine` value - the export predates that column
    being required - so falling back to the filename is the only way to keep that machine's
    rows in their own job rather than silently merging them into whichever group happens to
    be built first.
    """
    machine = row["machine"].strip()
    if machine:
        return machine
    stem = Path(row["source_file"]).stem
    for prefix in ("benchmark-", "results_", "results-"):
        if stem.startswith(prefix):
            return stem[len(prefix) :]
    return stem


def _float(value: str) -> float | None:
    value = value.strip()
    return float(value) if value else None


def _int(value: str) -> int | None:
    value = value.strip()
    return int(float(value)) if value else None


def _row_from_csv(csv_row: dict[str, str]) -> EvalResult:
    tok_s = _float(csv_row["tok_s"])
    return EvalResult(
        model=csv_row["model"],
        device=csv_row["device"],
        device_name=csv_row["device_name"].strip() or None,
        status="ok" if tok_s is not None else "error",
        detail=None if tok_s is not None else IMPORT_DETAIL,
        load_s=_float(csv_row["load_s"]),
        ttft_s=_float(csv_row["ttft_s"]),
        gen_tokens=_int(csv_row["gen_tokens"]),
        tok_s=tok_s,
        total_s=_float(csv_row["total_s"]),
        peak_mem_mb=_float(csv_row["peak_mem_mb"]),
        peak_vram_mb=_float(csv_row["peak_vram_mb"]),
        # This CSV is a 3-prompt summary, not a single measured prompt - there is no one
        # question or complexity tier to attribute the row to.
        question=None,
        prompt_label=None,
        complexity_tier=None,
        complexity_score=None,
    )


def seed_from_csv(db: Session, csv_path: Path = DEFAULT_CSV) -> int:
    """Imports every machine group in `csv_path` whose hardware isn't in `eval_results` yet.

    One BenchmarkJob per machine, skipped entirely if any of that group's device names
    already appears on an existing row - see the module docstring for why that is the gate
    instead of "the table is empty". Returns the number of EvalResult rows inserted (0 when
    every machine in the CSV is already represented).
    """
    if not csv_path.exists():
        return 0

    existing_names = {name for (name,) in db.query(EvalResult.device_name).distinct() if name}

    with csv_path.open(newline="", encoding="utf-8") as handle:
        rows_by_machine: dict[str, list[dict[str, str]]] = {}
        for csv_row in csv.DictReader(handle):
            rows_by_machine.setdefault(_machine_label(csv_row), []).append(csv_row)

    inserted = 0
    now = datetime.utcnow()
    for machine, csv_rows in sorted(rows_by_machine.items()):
        group_names = {
            csv_row["device_name"].strip() for csv_row in csv_rows if csv_row["device_name"].strip()
        }
        if group_names & existing_names:
            continue

        devices = sorted({row["device"] for row in csv_rows})
        models = sorted({row["model"] for row in csv_rows})
        job = BenchmarkJob(
            status="completed",
            devices=devices,
            models=models,
            total_runs=len(csv_rows),
            completed_runs=len(csv_rows),
            created_at=now,
            finished_at=now,
        )
        db.add(job)
        db.flush()  # assigns job.id, needed for each EvalResult's foreign key below

        for csv_row in csv_rows:
            result = _row_from_csv(csv_row)
            result.benchmark_job_id = job.id
            result.run_at = now
            db.add(result)
            inserted += 1

        # So a later group sharing a name with this one (there shouldn't be one, but the CSV
        # is external input) can't also slip through in the same call.
        existing_names |= group_names

    db.commit()
    return inserted


if __name__ == "__main__":
    from src.db import SessionLocal

    with SessionLocal() as session:
        count = seed_from_csv(session)
        print(f"Inserted {count} rows from {DEFAULT_CSV}.")

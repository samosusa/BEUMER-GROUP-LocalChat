"""Exports benchmark rows to a CSV that merges cleanly with other machines' exports.

Three people running `sqlite3 -csv "SELECT ..."` by hand produce three files with three
column orders, three notions of which run counts, and no column saying whose machine it
was. Merging those is guesswork. This produces one shape, so the files concatenate.

The comparison this feeds is "the same model on different hardware", and that only means
something if every machine measured the same models the same way. So the export refuses to
be quietly wrong: it prints what it found and names anything that would make the row
incomparable - a run from before the prompt sweep existed, a device with no hardware name,
a model only this machine has.
"""

from __future__ import annotations

import argparse
import csv
import socket
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "app.db"

# Fixed order, machine first: these files exist to be concatenated.
COLUMNS = (
    "machine",
    "device",
    "device_name",
    "model",
    "prompt_label",
    "complexity_tier",
    "complexity_score",
    "status",
    "detail",
    "load_s",
    "ttft_s",
    "gen_tokens",
    "tok_s",
    "total_s",
    "peak_mem_mb",
    "peak_vram_mb",
    "run_at",
    "benchmark_job_id",
)

# Columns added by migration 0011. Their absence means this database predates the prompt
# sweep, so every model has one row instead of three and the numbers are not comparable
# with a current run - worth saying out loud rather than exporting nulls.
SWEEP_COLUMNS = ("prompt_label", "complexity_tier", "complexity_score")


def table_columns(db: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def latest_completed_job(db: sqlite3.Connection) -> int | None:
    row = db.execute(
        "SELECT id FROM benchmark_jobs WHERE status = 'completed' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return row[0] if row else None


def fetch(db: sqlite3.Connection, job_id: int | None, present: set[str]) -> list[dict]:
    selected = [name for name in COLUMNS if name not in ("machine",) and name in present]
    sql = f"SELECT {', '.join(selected)} FROM eval_results"
    params: tuple = ()
    if job_id is not None:
        sql += " WHERE benchmark_job_id = ?"
        params = (job_id,)
    sql += " ORDER BY run_at, model, device, id"
    return [dict(zip(selected, row)) for row in db.execute(sql, params)]


def report(rows: list[dict], present: set[str]) -> list[str]:
    """Everything that would make this file merge badly with someone else's."""
    warnings: list[str] = []

    missing_sweep = [name for name in SWEEP_COLUMNS if name not in present]
    if missing_sweep:
        warnings.append(
            f"This database is missing {', '.join(missing_sweep)}, so it predates the prompt "
            "sweep: one row per model and device instead of three. Run "
            "`python scripts/db_migrate.py up` and benchmark again, or these rows cannot be "
            "compared with a current run."
        )

    measured = [row for row in rows if row.get("status") == "ok"]
    unnamed = {row["device"] for row in measured if not row.get("device_name")}
    if unnamed:
        warnings.append(
            f"No hardware name on {', '.join(sorted(unnamed))} rows. The whole point of a "
            "cross-machine chart is telling the machines apart, so these rows will merge into "
            "an unlabelled blob. Make sure you are on a build that probes the device name."
        )

    if "prompt_label" in present and measured:
        per_combo: dict[tuple[str, str], int] = {}
        for row in measured:
            key = (row["model"], row["device"])
            per_combo[key] = per_combo.get(key, 0) + 1
        partial = [f"{model} on {device}" for (model, device), n in per_combo.items() if n < 3]
        if partial:
            warnings.append(
                "Fewer than three questions measured for: " + ", ".join(sorted(partial)) +
                ". An interrupted run exports happily and looks complete in a chart."
            )

    devices = sorted({row["device"] for row in measured})
    if len(devices) < 2:
        measured_on = ", ".join(devices) if devices else "nothing"
        warnings.append(
            f"Measured on {measured_on}. The chart is CPU against GPU, so a machine that ran "
            "only one device contributes half a data point. If the GPU was refused, check "
            "`python -c \"import llama_cpp; print(llama_cpp.llama_supports_gpu_offload())\"`."
        )

    return warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--machine",
        help="Label for this machine, e.g. 'patrik-macbook'. Defaults to the hostname.",
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out", type=Path, help="Defaults to benchmark-<machine>.csv")
    parser.add_argument("--job", type=int, help="Benchmark job id. Defaults to the latest completed one.")
    parser.add_argument("--all-jobs", action="store_true", help="Every run in the database, not just one.")
    args = parser.parse_args()

    if not args.db.exists():
        print(f"No database at {args.db}. Run the service at least once.", file=sys.stderr)
        return 1

    machine = args.machine or socket.gethostname().split(".")[0]
    out = args.out or Path(f"benchmark-{machine}.csv")

    db = sqlite3.connect(args.db)
    present = table_columns(db, "eval_results")

    job_id = None
    if not args.all_jobs:
        job_id = args.job if args.job is not None else latest_completed_job(db)
        if job_id is None:
            print(
                "No completed benchmark job in this database. Run one from Settings, or with "
                "POST /benchmark, and wait for it to finish.",
                file=sys.stderr,
            )
            return 1

    rows = fetch(db, job_id, present)
    if not rows:
        print("That job has no rows.", file=sys.stderr)
        return 1

    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({**{name: "" for name in COLUMNS}, **row, "machine": machine})

    measured = [row for row in rows if row.get("status") == "ok"]
    models = sorted({row["model"] for row in measured})
    devices = sorted({row["device"] for row in measured})
    names = sorted({row.get("device_name") or "?" for row in measured})

    print(f"Wrote {out} - {len(rows)} rows ({len(measured)} measured) as machine '{machine}'.")
    print(f"  job      : {'all' if args.all_jobs else job_id}")
    print(f"  devices  : {', '.join(devices) or 'none'}")
    print(f"  hardware : {', '.join(names) or 'none'}")
    print(f"  models   : {len(models)}")
    for model in models:
        print(f"      {model}")

    warnings = report(rows, present)
    for warning in warnings:
        print(f"\nWARNING: {warning}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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

# Under this many generated tokens a run times start-up rather than generation, so it is
# left out of the perf means instead of quietly skewing them.
MIN_SAMPLE_TOKENS = 8

# The "performance" shape: one row per model and device instead of one per prompt, for
# comparing raw model throughput rather than how complexity moves latency. Matches the
# columns Matej's export already had, plus `machine` (so a row says whose it is),
# `samples` and the tok/s spread (so a single noisy draw cannot pass for a measurement).
PERF_COLUMNS = (
    "machine",
    "model",
    "device",
    "device_name",
    "samples",
    "load_s",
    "ttft_s",
    "gen_tokens",
    "tok_s",
    "tok_s_min",
    "tok_s_max",
    "total_s",
    "peak_mem_mb",
    "peak_vram_mb",
)


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


def _mean(values: list, digits: int):
    numbers = [v for v in values if v is not None]
    if not numbers:
        return ""
    return round(sum(numbers) / len(numbers), digits)


def aggregate(rows: list[dict], machine: str) -> list[dict]:
    """Collapse the prompt sweep into one row per model and device.

    Averages only rows that actually ran. A skipped or errored row has no numbers to
    average, and folding it in as a zero would quietly drag a model's throughput down.
    """
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        if row.get("status") != "ok":
            continue
        groups.setdefault((row["model"], row["device"]), []).append(row)

    out = []
    for (model, device), everything in sorted(groups.items()):
        # A run of a handful of tokens is not a throughput sample - its timing is start-up,
        # not generation. gemma answering "how often?" in five tokens pulled its GPU mean
        # from ~93 down to 81.7; the short answer is correct model behaviour, the average
        # was not. `samples` then reports what actually went into the mean, so a blank cell
        # never sits behind a count of three.
        members = [
            m for m in everything
            if m.get("tok_s") is not None and (m.get("gen_tokens") or 0) >= MIN_SAMPLE_TOKENS
        ]
        speeds = [m["tok_s"] for m in members]
        names = {m.get("device_name") for m in everything if m.get("device_name")}
        out.append({
            "machine": machine,
            "model": model,
            "device": device,
            "device_name": sorted(names)[0] if names else "",
            "samples": len(speeds),
            "load_s": _mean([m.get("load_s") for m in members], 2),
            "ttft_s": _mean([m.get("ttft_s") for m in members], 2),
            "gen_tokens": _mean([m.get("gen_tokens") for m in members], 0),
            "tok_s": _mean(speeds, 1),
            "tok_s_min": round(min(speeds), 1) if speeds else "",
            "tok_s_max": round(max(speeds), 1) if speeds else "",
            "total_s": _mean([m.get("total_s") for m in members], 2),
            "peak_mem_mb": _mean([m.get("peak_mem_mb") for m in members], 1),
            "peak_vram_mb": _mean([m.get("peak_vram_mb") for m in members], 1),
        })
    return out


def perf_warnings(rows: list[dict], aggregated: list[dict]) -> list[str]:
    warnings: list[str] = []

    thin = [f"{r['model']} on {r['device']} ({r['samples']})" for r in aggregated if r["samples"] < 3]
    if thin:
        warnings.append(
            "Averaged fewer than three samples for: " + ", ".join(sorted(thin)) +
            ". One draw is not a measurement; these means carry the noise of a single run."
        )

    varying = []
    for row in aggregated:
        counts = {
            m.get("gen_tokens")
            for m in rows
            if m.get("status") == "ok" and m["model"] == row["model"] and m["device"] == row["device"]
        }
        if len({c for c in counts if c is not None}) > 1:
            varying.append(f"{row['model']} on {row['device']}")
    if varying:
        warnings.append(
            "gen_tokens is not constant for: " + ", ".join(sorted(varying)) +
            ". Without a fixed generation budget, total_s and ttft_s are not comparable "
            "between rows - tok/s is the only figure that survives."
        )

    spread = [
        f"{r['model']} on {r['device']} ({r['tok_s_min']}-{r['tok_s_max']})"
        for r in aggregated
        if r["tok_s_min"] != "" and r["tok_s"] and (r["tok_s_max"] - r["tok_s_min"]) > 0.25 * r["tok_s"]
    ]
    if spread:
        warnings.append(
            "tok/s varies by more than 25% within: " + ", ".join(sorted(spread)) +
            ". The mean hides that. Usually a cold page cache on the first run of a model."
        )

    return warnings


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

    hollow: dict[tuple[str, str], int] = {}
    for row in measured:
        if row.get("tok_s") is None:
            key = (row["model"], row["device"])
            hollow[key] = hollow.get(key, 0) + 1
    if hollow:
        listed = ", ".join(
            f"{model} on {device} ({n} run{'s' if n > 1 else ''})"
            for (model, device), n in sorted(hollow.items())
        )
        warnings.append(
            "Recorded as 'ok' but produced no throughput figure: " + listed +
            ". These runs generated too few tokens to time - usually the model emitting "
            "end-of-sequence immediately on the raw-completion prompt. They are NOT "
            "measurements and must not be merged as if they were."
        )

    starved: dict[tuple[str, str], int] = {}
    for row in measured:
        if row.get("gen_tokens") is not None and row["gen_tokens"] < MIN_SAMPLE_TOKENS:
            key = (row["model"], row["device"])
            starved[key] = starved.get(key, 0) + 1
    if starved:
        listed = ", ".join(
            f"{model} on {device} ({n} run{'s' if n > 1 else ''})"
            for (model, device), n in sorted(starved.items())
        )
        warnings.append(
            f"Generated fewer than {MIN_SAMPLE_TOKENS} tokens: " + listed +
            ". Their timing covers start-up rather than generation, so --shape perf leaves "
            "them out of the means. A short answer to a short question is correct model "
            "behaviour; it is just not a throughput sample."
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
    parser.add_argument(
        "--shape",
        choices=("sweep", "perf"),
        default="sweep",
        help="sweep: one row per prompt (default). perf: one row per model and device.",
    )
    args = parser.parse_args()

    if not args.db.exists():
        print(f"No database at {args.db}. Run the service at least once.", file=sys.stderr)
        return 1

    machine = args.machine or socket.gethostname().split(".")[0]
    suffix = "-perf" if args.shape == "perf" else ""
    out = args.out or Path(f"benchmark-{machine}{suffix}.csv")

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

    aggregated = aggregate(rows, machine) if args.shape == "perf" else []
    fieldnames = PERF_COLUMNS if args.shape == "perf" else COLUMNS
    payload = aggregated if args.shape == "perf" else [
        {**{name: "" for name in COLUMNS}, **row, "machine": machine} for row in rows
    ]

    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in payload:
            writer.writerow(row)

    measured = [row for row in rows if row.get("status") == "ok"]
    models = sorted({row["model"] for row in measured})
    devices = sorted({row["device"] for row in measured})
    names = sorted({row.get("device_name") or "?" for row in measured})

    written = len(payload)
    shape_note = " [perf: one row per model+device]" if args.shape == "perf" else ""
    print(f"Wrote {out} - {written} rows ({len(measured)} measured){shape_note} as machine '{machine}'.")
    print(f"  job      : {'all' if args.all_jobs else job_id}")
    print(f"  devices  : {', '.join(devices) or 'none'}")
    print(f"  hardware : {', '.join(names) or 'none'}")
    print(f"  models   : {len(models)}")
    for model in models:
        print(f"      {model}")

    warnings = report(rows, present)
    if args.shape == "perf":
        warnings = perf_warnings(rows, aggregated) + warnings
    for warning in warnings:
        print(f"\nWARNING: {warning}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Background benchmark harness: same shape as src/ingest/pipeline.py (a job row updated
as it goes, polled via /benchmark/status/{id}), but timing GGUF model load + generation
on CPU and/or GPU instead of indexing a document.

Uses the same raw-completion call path as llm_adapter.generate() (not chat-completion)
so numbers reflect how this app actually calls models, and reads timing straight from
llama.cpp's own perf counters rather than hand-timing around Python overhead - the same
approach scripts/bench_llm.py already validated for the standalone CLI benchmark.
"""

from __future__ import annotations

import gc
import platform
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from src.complexity import measure_complexity
from src.llm_adapter import MODELS_DIR, gpu_available, llm_adapter
from src.models.benchmark_job import BenchmarkJob
from src.models.eval_result import EvalResult

# One prompt per complexity tier (see src/complexity.py) so a benchmark run reports
# latency/throughput broken down by how hard the prompt is, not just a single fixed
# question - a model that's fast on a one-fact lookup may not stay fast on a multi-part
# reasoning prompt with more context to attend to. Tiers below are verified by
# measure_complexity() itself in tests/unit/test_benchmark.py, not asserted by hand here.
BENCHMARK_CONTEXT = (
    "Emergency stop pull-cords must be tested at the start of every shift. Pull the cord at the "
    "midpoint of each belt section and confirm the drive motor cuts power within 500ms. Log the "
    "test in the shift handover sheet before the line is released for operation."
)
BENCHMARK_PROMPTS = (
    {"label": "simple", "question": "How often should pull-cords be inspected?"},
    {"label": "moderate", "question": "How do I test an emergency stop pull-cord?"},
    {
        "label": "complex",
        "question": (
            "Why must pull-cords be tested every shift, and what happens if the drive "
            "motor does not cut power in time?"
        ),
    },
)
MAX_TOKENS = 128
N_CTX = 4096
TEMPERATURE = 0.1
TOP_P = 0.9


def _prompt(question: str) -> str:
    return (
        "You answer questions using only the provided documentation. "
        "If the documentation does not contain the answer, say that it is not available.\n\n"
        f"Documentation:\n[1] {BENCHMARK_CONTEXT}\n\nQuestion: {question}\nAnswer:"
    )


def _gpu_device_name() -> str | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        lines = out.stdout.strip().splitlines()
        return lines[0].strip() if lines else None
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None


def _gpu_vram_used_mb() -> float | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        lines = out.stdout.strip().splitlines()
        return float(lines[0].strip()) if lines else None
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError):
        return None


def _cpu_device_name() -> str:
    return platform.processor() or platform.machine() or "cpu"


@dataclass
class BenchmarkRow:
    model: str
    device: str
    question: str
    prompt_label: str
    complexity_tier: str
    complexity_score: float
    device_name: str | None = None
    status: str = "pending"
    detail: str | None = None
    load_s: float | None = None
    ttft_s: float | None = None
    gen_tokens: int | None = None
    tok_s: float | None = None
    total_s: float | None = None
    peak_mem_mb: float | None = None
    peak_vram_mb: float | None = None


def resolve_models(models_dir: Path, model_names: list[str] | None) -> list[Path]:
    all_models = sorted(models_dir.glob("*.gguf"))
    if not model_names:
        return all_models
    wanted = set(model_names)
    return [path for path in all_models if path.name in wanted]


def run_one(model_path: Path, device: str, prompt_spec: dict) -> BenchmarkRow:
    complexity = measure_complexity(prompt_spec["question"])
    row = BenchmarkRow(
        model=model_path.name,
        device=device,
        question=prompt_spec["question"],
        prompt_label=prompt_spec["label"],
        complexity_tier=complexity.tier,
        complexity_score=complexity.score,
    )
    if device == "gpu" and not gpu_available():
        row.status = "skipped"
        row.detail = "no CUDA/GPU offload support in the installed llama-cpp-python build"
        return row

    import llama_cpp as llama_cpp_module
    import psutil
    from llama_cpp import Llama

    proc = psutil.Process()
    n_gpu_layers = -1 if device == "gpu" else 0
    idle_vram_mb = _gpu_vram_used_mb() if device == "gpu" else None
    llm: Any = None
    try:
        t0 = time.perf_counter()
        llm = Llama(model_path=str(model_path), n_gpu_layers=n_gpu_layers, n_ctx=N_CTX, verbose=False)
        row.load_s = time.perf_counter() - t0
        row.device_name = _gpu_device_name() if device == "gpu" else _cpu_device_name()

        prompt = _prompt(prompt_spec["question"])
        llm.reset()  # force a full prompt re-eval instead of reusing any cached KV state
        llm._ctx.reset_timings()
        t_start = time.perf_counter()
        first_token_t: float | None = None
        for chunk in llm(prompt, max_tokens=MAX_TOKENS, temperature=TEMPERATURE, top_p=TOP_P, stream=True):
            piece = chunk["choices"][0]["text"]
            if piece and first_token_t is None:
                first_token_t = time.perf_counter()
        t_end = time.perf_counter()

        perf = llama_cpp_module.llama_perf_context(llm._ctx.ctx)
        gen_s = perf.t_eval_ms / 1000

        row.status = "ok"
        row.ttft_s = (first_token_t or t_end) - t_start
        row.gen_tokens = perf.n_eval
        row.tok_s = (perf.n_eval / gen_s) if gen_s else None
        row.total_s = row.load_s + (t_end - t_start)
        row.peak_mem_mb = round(proc.memory_info().rss / (1024 * 1024), 1)
        if device == "gpu":
            now_vram = _gpu_vram_used_mb()
            if now_vram is not None and idle_vram_mb is not None:
                row.peak_vram_mb = round(max(now_vram - idle_vram_mb, 0.0), 1)
    except Exception as exc:  # a single model/device combo failing shouldn't abort the whole job
        row.status = "error"
        row.detail = str(exc)
    finally:
        if llm is not None:
            close = getattr(llm, "close", None)
            if callable(close):
                close()
            del llm
        gc.collect()
        if device == "gpu":
            time.sleep(0.5)  # let the driver release VRAM before the next model loads

    return row


def _get_job(db: Session, job_id: int) -> BenchmarkJob:
    job = db.get(BenchmarkJob, job_id)
    if job is None:
        raise ValueError(f"Benchmark job {job_id} not found")
    return job


def _mark_failed(db: Session, job_id: int, error: Exception) -> None:
    db.rollback()
    job = db.get(BenchmarkJob, job_id)
    if job is not None:
        job.status = "failed"
        job.error = str(error)
        job.finished_at = datetime.utcnow()
        db.commit()


def _store_row(db: Session, job: BenchmarkJob, row: BenchmarkRow) -> None:
    db.add(
        EvalResult(
            benchmark_job_id=job.id,
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
            run_at=datetime.utcnow(),
        )
    )
    job.completed_runs += 1
    db.commit()


def run_benchmark_job(db: Session, job_id: int, models_dir: Path | None = None) -> None:
    job = _get_job(db, job_id)
    try:
        # Benchmarking loads its own Llama instances directly, alongside whatever
        # /models/active currently has loaded - on an 8GB card that's an easy OOM, so
        # free the shared adapter's model first. The active selection is not restored
        # automatically; re-select it via POST /models/active once the run completes.
        llm_adapter.unload()

        model_paths = resolve_models(models_dir or MODELS_DIR, job.models)
        if not model_paths:
            raise ValueError("No matching GGUF models found in data/models/")

        job.total_runs = len(model_paths) * len(job.devices) * len(BENCHMARK_PROMPTS)
        job.completed_runs = 0
        db.commit()

        for model_path in model_paths:
            for device in job.devices:
                for prompt_spec in BENCHMARK_PROMPTS:
                    job.current_model = model_path.name
                    job.current_device = device
                    db.commit()

                    row = run_one(model_path, device, prompt_spec)
                    _store_row(db, job, row)

        job.status = "completed"
        job.current_model = None
        job.current_device = None
        job.finished_at = datetime.utcnow()
        db.commit()
    except Exception as error:
        _mark_failed(db, job_id, error)
        raise

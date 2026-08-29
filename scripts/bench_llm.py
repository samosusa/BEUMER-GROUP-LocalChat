"""Benchmark local GGUF models on CPU and GPU with llama-cpp-python.

Loops every model in data/models/*.gguf, runs it on each requested device,
and reports the throughput/resource metrics needed for a CPU-vs-GPU
comparison: load time, time-to-first-token, prompt/generation tok/s (read
straight from llama.cpp's own perf counters, not hand-timed), total
wall-clock latency, and peak RAM/VRAM.

Usage:
    python scripts/bench_llm.py
    python scripts/bench_llm.py --devices cpu
    python scripts/bench_llm.py --devices cpu gpu --gpu-layers 20 --runs 5
"""

from __future__ import annotations

import argparse
import csv
import gc
import json
import os
import platform
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "data" / "models"
RESULTS_DIR = ROOT / "eval_results"


def _add_cuda_runtime_to_path() -> None:
    """CUDA 13.x moved cudart/cublas DLLs into bin\\x64 instead of bin directly;
    llama.dll's CUDA backend won't load unless that directory is on PATH."""
    cuda_path = os.environ.get("CUDA_PATH")
    if not cuda_path:
        candidates = sorted(Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA").glob("v*"), reverse=True)
        cuda_path = str(candidates[0]) if candidates else None
    if not cuda_path:
        return
    for sub in ("bin/x64", "bin"):
        p = Path(cuda_path) / sub
        if p.is_dir() and str(p) not in os.environ["PATH"]:
            os.environ["PATH"] = str(p) + os.pathsep + os.environ["PATH"]


if platform.system() == "Windows":
    _add_cuda_runtime_to_path()

# --- Pinned controls: keep these identical across every run being compared ---
TEMPERATURE = 0.1
TOP_P = 0.9
SAMPLE_INTERVAL_S = 0.3
VRAM_FIT_OVERHEAD = 1.15  # rough headroom for KV-cache/context buffers beyond raw file size
VRAM_FIT_SAFETY_MB = 512

SYSTEM_PROMPT = (
    "You answer questions using only the provided documentation. "
    "If the documentation does not contain the answer, say that it is not available. "
    "Cite supporting source numbers like [1]."
)

DEFAULT_QUESTION = "How often should the emergency stop pull-cords be inspected, and what is the procedure?"

# Fixed synthetic "retrieved chunks" so every model/device sees the same input text.
_CHUNK_POOL = [
    ("Conveyor Safety Manual", "Emergency Stops", "12",
     "Emergency stop pull-cords must be tested at the start of every shift. Pull the cord at the "
     "midpoint of each belt section and confirm the drive motor cuts power within 500ms. Log the "
     "test in the shift handover sheet before the line is released for operation."),
    ("Conveyor Safety Manual", "Lockout/Tagout", "14",
     "Before any maintenance on a belt section, isolate the local disconnect, apply a personal "
     "lock and tag, and verify zero energy state by attempting a normal start from the operator "
     "panel. The attempt must fail before work begins."),
    ("Maintenance Handbook", "Belt Tensioning", "31",
     "Check belt tension weekly using the tension gauge at the designated test point. Tension "
     "outside the 400-550N band should be adjusted at the tail pulley take-up and re-measured "
     "after the belt has run for at least five minutes."),
    ("Maintenance Handbook", "Roller Inspection", "44",
     "Idler rollers should be inspected monthly for bearing noise, seal wear, and shell "
     "deformation. Replace any roller that shows more than 2mm of shell wobble when rotated by "
     "hand."),
    ("Incident Response Guide", "Jam Clearance", "8",
     "If a jam trips an emergency stop, do not reset the circuit until the jammed section has "
     "been visually inspected end to end and the cause of the jam has been documented in the "
     "incident log."),
]


@dataclass
class RunResult:
    model: str
    device: str
    device_name: str = ""
    status: str = "pending"
    detail: str = ""
    n_gpu_layers: int = 0
    n_threads: int = 0
    n_ctx: int = 0
    runs: int = 0
    load_s: float | None = None
    ttft_s: float | None = None
    prompt_tokens: int | None = None
    prompt_eval_s: float | None = None
    prompt_tok_s: float | None = None
    gen_tokens: int | None = None
    gen_eval_s: float | None = None
    gen_tok_s: float | None = None
    total_s: float | None = None
    peak_ram_mb: float | None = None
    peak_vram_mb: float | None = None


def get_cpu_info() -> dict[str, Any]:
    physical = psutil.cpu_count(logical=False) or os.cpu_count() or 1
    logical = psutil.cpu_count(logical=True) or os.cpu_count() or 1
    name = platform.processor() or "unknown"
    if platform.system() == "Windows":
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor).Name"],
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            cleaned = out.stdout.strip()
            if cleaned:
                name = cleaned
        except Exception:
            pass
    return {"name": name, "physical_cores": physical, "logical_cores": logical}


def get_gpu_info() -> dict[str, Any] | None:
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,memory.free,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    line = out.stdout.strip().splitlines()[0]
    name, total, used, free, driver = (part.strip() for part in line.split(","))
    return {
        "name": name,
        "vram_total_mb": float(total),
        "vram_used_mb": float(used),
        "vram_free_mb": float(free),
        "driver_version": driver,
    }


def collect_system_info() -> dict[str, Any]:
    import llama_cpp

    cpu = get_cpu_info()
    gpu = get_gpu_info()
    return {
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "python_version": platform.python_version(),
        "llama_cpp_version": getattr(llama_cpp, "__version__", "unknown"),
        "cpu_name": cpu["name"],
        "cpu_physical_cores": cpu["physical_cores"],
        "cpu_logical_cores": cpu["logical_cores"],
        "ram_total_gb": psutil.virtual_memory().total / (1024**3),
        "gpu_name": gpu["name"] if gpu else None,
        "gpu_vram_total_mb": gpu["vram_total_mb"] if gpu else None,
        "gpu_driver_version": gpu["driver_version"] if gpu else None,
        "cuda_offload_supported": bool(llama_cpp.llama_supports_gpu_offload()),
    }


def print_system_info(info: dict[str, Any]) -> None:
    print("=== System ===")
    print(f"OS: {info['os']}")
    print(f"Python: {info['python_version']} | llama-cpp-python: {info['llama_cpp_version']} "
          f"(GPU offload support: {info['cuda_offload_supported']})")
    print(f"CPU: {info['cpu_name']} ({info['cpu_physical_cores']} cores / {info['cpu_logical_cores']} threads)")
    print(f"RAM: {info['ram_total_gb']:.1f} GB")
    if info["gpu_name"]:
        print(
            f"GPU: {info['gpu_name']} ({info['gpu_vram_total_mb'] / 1024:.1f} GB VRAM, "
            f"driver {info['gpu_driver_version']})"
        )
    else:
        print("GPU: none detected")
    print()


def build_messages(top_k: int, question: str) -> list[dict[str, str]]:
    reps = (top_k // len(_CHUNK_POOL)) + 1
    chunks = (_CHUNK_POOL * reps)[:top_k]
    context = "\n\n".join(
        f"[{i}] {title} | section: {section} | page: {page}\n{text}"
        for i, (title, section, page, text) in enumerate(chunks, start=1)
    )
    # A separate "system" role is folded into the user turn: some GGUF chat templates
    # (e.g. Gemma's) reject a system message outright, so this is the one message shape
    # every model family's embedded template accepts.
    user_content = f"{SYSTEM_PROMPT}\n\nDocumentation:\n{context}\n\nQuestion: {question}\nAnswer:"
    return [
        {"role": "user", "content": user_content},
    ]


class ResourceSampler:
    """Polls process RSS (and GPU VRAM used, if requested) on a background thread."""

    def __init__(self, sample_vram: bool):
        self._sample_vram = sample_vram
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._proc = psutil.Process(os.getpid())
        self.peak_ram_mb = 0.0
        self.peak_vram_used_mb = 0.0

    def _poll(self) -> None:
        while not self._stop.is_set():
            try:
                rss_mb = self._proc.memory_info().rss / (1024 * 1024)
                self.peak_ram_mb = max(self.peak_ram_mb, rss_mb)
            except Exception:
                pass
            if self._sample_vram:
                gpu = get_gpu_info()
                if gpu:
                    self.peak_vram_used_mb = max(self.peak_vram_used_mb, gpu["vram_used_mb"])
            self._stop.wait(SAMPLE_INTERVAL_S)

    def start(self) -> None:
        self._thread = threading.Thread(target=self._poll, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)


def estimate_gpu_fit(model_path: Path, gpu: dict[str, Any]) -> tuple[bool, str]:
    file_mb = model_path.stat().st_size / (1024 * 1024)
    estimated_mb = file_mb * VRAM_FIT_OVERHEAD + VRAM_FIT_SAFETY_MB
    free_mb = gpu["vram_free_mb"]
    if estimated_mb > free_mb:
        return False, (
            f"needs ~{estimated_mb / 1024:.1f} GB, only {free_mb / 1024:.1f} GB free on {gpu['name']}"
        )
    return True, ""


def run_one(model_path: Path, device: str, device_name: str, args: argparse.Namespace) -> RunResult:
    result = RunResult(
        model=model_path.name,
        device=device,
        device_name=device_name,
        n_threads=args.n_threads,
        n_ctx=args.n_ctx,
    )

    import llama_cpp

    if device == "gpu":
        if not llama_cpp.llama_supports_gpu_offload():
            result.status = "skipped"
            result.detail = "installed llama-cpp-python build has no GPU offload support"
            return result
        gpu = get_gpu_info()
        if gpu is None:
            result.status = "skipped"
            result.detail = "no NVIDIA GPU detected (nvidia-smi unavailable)"
            return result
        fits, reason = estimate_gpu_fit(model_path, gpu)
        if not fits:
            result.status = "skipped"
            result.detail = reason
            return result

    n_gpu_layers = args.gpu_layers if device == "gpu" else 0
    result.n_gpu_layers = n_gpu_layers

    idle_vram_mb = 0.0
    if device == "gpu":
        gpu_now = get_gpu_info()
        idle_vram_mb = gpu_now["vram_used_mb"] if gpu_now else 0.0

    sampler = ResourceSampler(sample_vram=(device == "gpu"))
    sampler.start()
    llm = None
    try:
        from llama_cpp import Llama

        t0 = time.perf_counter()
        llm = Llama(
            model_path=str(model_path),
            n_gpu_layers=n_gpu_layers,
            n_threads=args.n_threads,
            n_ctx=args.n_ctx,
            # chat_format left as None: llama-cpp-python auto-detects and applies the
            # chat template embedded in each GGUF's metadata, so every model family
            # gets its own correct prompt format without hand-coding one per family.
            chat_format=None,
            verbose=False,
        )
        result.load_s = time.perf_counter() - t0

        messages = build_messages(args.top_k, args.question)

        for _ in range(args.warmup):
            llm.reset()  # force a full prompt re-eval instead of reusing cached KV state
            for _chunk in llm.create_chat_completion(
                messages=messages, max_tokens=args.max_tokens,
                temperature=TEMPERATURE, top_p=TOP_P, stream=True,
            ):
                pass

        ttfts: list[float] = []
        gen_wall_s: list[float] = []
        prompt_tok_total = 0
        prompt_s_total = 0.0
        gen_tok_total = 0
        gen_s_total = 0.0

        for _ in range(args.runs):
            llm.reset()  # force a full prompt re-eval instead of reusing cached KV state
            llm._ctx.reset_timings()
            t_start = time.perf_counter()
            first_token_t: float | None = None
            for chunk in llm.create_chat_completion(
                messages=messages, max_tokens=args.max_tokens,
                temperature=TEMPERATURE, top_p=TOP_P, stream=True,
            ):
                delta = chunk["choices"][0]["delta"].get("content")
                if delta and first_token_t is None:
                    first_token_t = time.perf_counter()
            t_end = time.perf_counter()

            perf = llama_cpp.llama_perf_context(llm._ctx.ctx)
            ttfts.append((first_token_t or t_end) - t_start)
            gen_wall_s.append(t_end - t_start)
            prompt_tok_total += perf.n_p_eval
            prompt_s_total += perf.t_p_eval_ms / 1000
            gen_tok_total += perf.n_eval
            gen_s_total += perf.t_eval_ms / 1000

        result.status = "ok"
        result.runs = args.runs
        result.ttft_s = sum(ttfts) / len(ttfts)
        result.prompt_tokens = round(prompt_tok_total / args.runs)
        result.prompt_eval_s = prompt_s_total / args.runs
        result.prompt_tok_s = (prompt_tok_total / prompt_s_total) if prompt_s_total else None
        result.gen_tokens = round(gen_tok_total / args.runs)
        result.gen_eval_s = gen_s_total / args.runs
        result.gen_tok_s = (gen_tok_total / gen_s_total) if gen_s_total else None
        result.total_s = result.load_s + (sum(gen_wall_s) / len(gen_wall_s))
    except Exception as exc:
        result.status = "error"
        result.detail = str(exc)
    finally:
        if llm is not None:
            llm.close()
            del llm
        sampler.stop()
        result.peak_ram_mb = round(sampler.peak_ram_mb, 1)
        if device == "gpu":
            result.peak_vram_mb = round(max(sampler.peak_vram_used_mb - idle_vram_mb, 0.0), 1)
        gc.collect()
        if device == "gpu":
            time.sleep(1.0)  # let the driver release VRAM before the next model loads

    return result


ROW_FIELDS = ["model", "device", "device_name", "load_s", "ttft_s", "gen_tokens", "tok_s", "total_s", "peak_mem_mb"]


def output_row(r: RunResult) -> dict[str, Any]:
    peak_mem = r.peak_vram_mb if r.device == "gpu" else r.peak_ram_mb
    return {
        "model": r.model,
        "device": r.device,
        "device_name": r.device_name,
        "load_s": round(r.load_s, 2) if r.load_s is not None else None,
        "ttft_s": round(r.ttft_s, 2) if r.ttft_s is not None else None,
        "gen_tokens": r.gen_tokens,
        "tok_s": round(r.gen_tok_s, 1) if r.gen_tok_s is not None else None,
        "total_s": round(r.total_s, 2) if r.total_s is not None else None,
        "peak_mem_mb": round(peak_mem, 1) if peak_mem is not None else None,
    }


def format_result_line(r: RunResult) -> str:
    if r.status != "ok":
        return f"  {r.status}: {r.detail}"
    row = output_row(r)
    return (
        f"  {row['device_name']} | load {row['load_s']:.2f}s | TTFT {row['ttft_s']:.2f}s | "
        f"{row['gen_tokens']} tok @ {row['tok_s']:.1f} tok/s | "
        f"total {row['total_s']:.2f}s | peak mem {row['peak_mem_mb']:.0f} MB"
    )


def format_markdown_table(results: list[RunResult]) -> str:
    header = "| Model | Device | Device name | Load (s) | TTFT (s) | Tokens gen | Tok/s | Total (s) | Peak RAM/VRAM |"
    sep = "|---|---|---|---|---|---|---|---|---|"
    rows = [header, sep]
    for r in results:
        if r.status != "ok":
            rows.append(f"| {r.model} | {r.device} | {r.device_name} | - | - | - | - | - | {r.status}: {r.detail} |")
            continue
        row = output_row(r)
        rows.append(
            f"| {row['model']} | {row['device']} | {row['device_name']} | {row['load_s']:.2f} | "
            f"{row['ttft_s']:.2f} | {row['gen_tokens']} | {row['tok_s']:.1f} | {row['total_s']:.2f} | "
            f"{row['peak_mem_mb']:.0f} MB |"
        )
    return "\n".join(rows)


def write_csv(path: Path, results: list[RunResult]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=ROW_FIELDS)
        writer.writeheader()
        for r in results:
            writer.writerow(output_row(r))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-dir", type=Path, default=MODELS_DIR)
    parser.add_argument("--pattern", default="*.gguf")
    parser.add_argument("--devices", nargs="+", choices=["cpu", "gpu"], default=["cpu", "gpu"])
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--top-k", type=int, default=5, help="number of synthetic retrieved chunks in the prompt")
    parser.add_argument("--n-ctx", type=int, default=4096)
    parser.add_argument(
        "--n-threads",
        type=int,
        default=psutil.cpu_count(logical=False) or os.cpu_count() or 8,
        help="pinned identically across every CPU run",
    )
    parser.add_argument(
        "--gpu-layers", type=int, default=-1,
        help="n_gpu_layers for GPU runs; -1 offloads every layer",
    )
    parser.add_argument("--warmup", type=int, default=1, help="discarded generation runs before timing starts")
    parser.add_argument("--runs", type=int, default=3, help="timed generation runs to average per model/device")
    parser.add_argument("--question", default=DEFAULT_QUESTION)
    parser.add_argument("--out-dir", type=Path, default=RESULTS_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    sysinfo = collect_system_info()
    print_system_info(sysinfo)

    model_paths = sorted(args.models_dir.glob(args.pattern))
    if not model_paths:
        print(f"No GGUF models found in {args.models_dir} (pattern={args.pattern})")
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.out_dir / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "system_info.json").write_text(json.dumps(sysinfo, indent=2))

    device_names = {
        "cpu": sysinfo["cpu_name"],
        "gpu": sysinfo["gpu_name"] or "n/a",
    }

    results: list[RunResult] = []
    for model_path in model_paths:
        for device in args.devices:
            print(f"=== {model_path.name} [{device}] ===")
            result = run_one(model_path, device, device_names[device], args)
            print(format_result_line(result))
            results.append(result)
            (run_dir / f"{model_path.stem}_{device}.json").write_text(json.dumps(output_row(result), indent=2))

    write_csv(run_dir / "results.csv", results)
    table = format_markdown_table(results)
    (run_dir / "summary.md").write_text(table)
    print("\n" + table)
    print(f"\nResults written to {run_dir}")


if __name__ == "__main__":
    main()

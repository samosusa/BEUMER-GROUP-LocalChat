# GPU acceleration: CUDA vs Vulkan prerequisites

GPU support in `llama-cpp-python` is a **compile-time property of the installed build**, not
a runtime setting. The Settings → Compute toggle in the interface only switches
`n_gpu_layers` on a model that's already loaded (see `src/llm_adapter.py`); it can never make
GPU offload possible on a machine where the installed build doesn't have it. Getting GPU
support onto a machine at all is the job of everything below, not the frontend.

This covers both delivery paths in this repo: the Electron installer (the shipping artefact)
running directly on Windows, and the Docker image (`Dockerfile`, review/CI target only — see
the note in `docker-compose.yml`).

## TL;DR

|            | Vendor coverage    | Relative speed on NVIDIA                                              | Needs matching a driver/toolkit version                      | Extra wheel index                                                         |
| ---------- | ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **CUDA**   | NVIDIA only        | Fastest — especially prompt processing/prefill                        | Yes — driver must support the CUDA version the wheel targets | `--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124`  |
| **Vulkan** | NVIDIA, AMD, Intel | Slower than CUDA, especially prefill; decode gap is small and closing | No — rides whatever Vulkan ICD the GPU driver already ships  | `--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/vulkan` |

## Bare-metal prerequisites (the Electron installer's world)

### CUDA

- An NVIDIA GPU.
- An NVIDIA display driver new enough to support the CUDA version the wheel was built
  against (check with `nvidia-smi`, which prints the max supported CUDA version top-right).
  The prebuilt wheel bundles the CUDA runtime/cuBLAS libraries it needs — the full CUDA
  Toolkit does **not** need to be installed separately just to run it.
- `pip install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124 -r requirements.txt`
- Verify: `python -c "import llama_cpp; print(llama_cpp.llama_supports_gpu_offload())"` must
  print `True`.
- **Permissions:** none, as long as the venv lives under the user's own profile (not
  `Program Files`). Installing/updating the NVIDIA driver itself needs Administrator rights
  (UAC) — but that's a one-time, host/IT-level step, not something the app or `pip` does.

### Vulkan

- Any GPU (NVIDIA, AMD, or Intel, discrete or integrated) with a reasonably current driver.
  The Vulkan loader/ICD ships as part of the normal graphics driver on all three vendors —
  there is no separate "Vulkan install" for an end user in the common case. The Vulkan SDK
  (LunarG) is only needed if _building_ llama.cpp from source with validation layers; it is
  not needed to run a prebuilt wheel.
- `pip install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/vulkan -r requirements.txt`
- Verify the same way: `llama_cpp.llama_supports_gpu_offload()` must print `True`.
- **Permissions:** none, same reasoning as CUDA above. Vulkan is more driver-version-sensitive
  than CUDA in practice (reports of inconsistent throughput across driver versions), so "it
  works" is worth confirming with a real benchmark run, not just the boolean check.

## Docker prerequisites

The root `Dockerfile` currently pins the CPU-only wheel index on purpose (see its comments) —
today's image has no GPU path at all. Docker adds a layer the bare-metal case doesn't have:
**the image can decide which build gets installed, but it cannot grant itself access to the
host's GPU.** That access is always requested and granted by the host, outside the image.

### What Docker _can_ automate (lives in this repo)

- **Which backend the image installs.** Swap the base image from `python:3.11-slim` to a CUDA
  base (e.g. `nvidia/cuda:12.4.1-runtime-ubuntu22.04`) and point pip at the `cu124` (or
  `vulkan`) wheel index instead of the CPU-only one currently pinned in `Dockerfile`.
- **Requesting the GPU at container start**, via a `deploy.resources.reservations.devices`
  block in `docker-compose.yml` (Compose's GPU-reservation syntax, `driver: nvidia`). Anyone
  running `docker compose up` then gets that request automatically — they don't need to
  remember a `--gpus all` flag by hand.

### What Docker can _not_ automate (host-level, one-time, outside the repo)

- **The GPU driver itself** must already be installed on the host machine — the container
  borrows it via passthrough, it does not ship or install its own.
- **NVIDIA Container Toolkit** must be installed on the host for CUDA passthrough to work at
  all (Linux) — without it, a GPU reservation just fails at container start.
- **On Windows**, GPU passthrough into a container additionally requires Docker Desktop
  running on the **WSL2** backend, plus a Windows NVIDIA driver that supports WSL2 GPU
  paravirtualization. This path is mature for CUDA.
- **Vulkan passthrough into a Windows container is not well-standardized** — the CUDA-on-WSL2
  path is well-trodden, Vulkan's isn't. On Linux hosts, Vulkan passthrough generally needs
  `/dev/dri` device passthrough instead of the NVIDIA Container Toolkit.
- None of the above can be triggered by anything baked into `Dockerfile` or
  `docker-compose.yml` — they're prerequisites the host must already satisfy before `docker
compose up` is run.

### Practical implication

Because the shipping artefact is the Electron installer, not this Docker image (see the note
at the top of `docker-compose.yml`), a GPU-enabled Docker image is mainly useful for
benchmarking/review on a GPU box under our control, where the host-level prerequisites above
are a one-time setup we do ourselves. It does not solve GPU enablement for end users running
the packaged `.exe` — that path only goes through the bare-metal prerequisites above.

## Recommendation recap

Given BEUMER's fleet is a mix of unknown/varied hardware (see the multi-machine benchmark CSV
workflow in `docs/running-for-real.md`), and this app's RAG queries are prefill-heavy (a full
document context is sent on every question, per `src/retriever.py`) — the phase where Vulkan
lags CUDA the most on NVIDIA hardware — the two backends aren't strictly interchangeable on
performance grounds:

- **Vulkan** as a single bundled default gives the broadest out-of-the-box coverage
  (NVIDIA/AMD/Intel) with no per-vendor branching, at some latency cost on NVIDIA machines.
- **CUDA**, offered in addition where an NVIDIA GPU is detected, recovers that latency for
  whatever share of the fleet is NVIDIA, at the cost of shipping/maintaining a second backend
  and a hardware-detection step.

Neither choice requires elevated Windows permissions to install; the only step that ever does
is a host GPU driver update, which is a one-time IT-level concern independent of this app.

# Running LocalChat for real

Every screenshot taken before this document existed was mock data. This is how to get
numbers that came off a machine.

Each step ends with a check. Run it. The failure mode this project keeps hitting is
something that runs, fails quietly, and shows a confident screen anyway — the checks exist
so that cannot happen to you at 2am before a hand-in.

The two switches that decide whether anything on screen is real:

- **`npm run dev:live`**, never `npm run dev`. Nothing auto-detects. A UI that silently fell
  back to fixtures when the service was down would be the worst of both worlds.
- **Never `npm start`** while the Python service is up. That is the Node health service and
  it binds the same port 8000. It would answer `/health` convincingly and fail everything
  else.

---

## 1. Tools on the machine

```bash
python3 --version     # 3.11 recommended, 3.10 the minimum
node --version        # must be >= 22.22.2; use `nvm use` in the repo
xcode-select -p       # must print a path, not an error
```

**On macOS, `python3` is usually the system 3.9, and that is not good enough.** The models
and `src/api/query.py` annotate with `str | None` without `from __future__ import
annotations`, so on 3.9 those expressions are evaluated at class-creation time and raise
`TypeError: unsupported operand type(s) for |` from inside SQLAlchemy - which reads like a
broken dependency rather than a wrong interpreter. The whole dependency tree installs
happily first, so you find out twenty minutes in. `src/app.py` now refuses with a sentence
that says which interpreter you are on, but the fix is the same: get a newer one.

```bash
brew install python@3.12
/opt/homebrew/bin/python3.12 -m venv .venv    # or python3.11, or pyenv
```

If `xcode-select` errors, run `xcode-select --install` and wait for it to finish.
`llama-cpp-python` compiles native code and will not build without it.

---

## 2. Python environment

```bash
cd ~/BEUMER-GROUP-LocalChat
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

This is a heavy tree — FAISS, PyTorch through sentence-transformers, and a compiled
llama-cpp-python. Expect ten to twenty minutes and a gigabyte or two of downloads.

**Check:**

```bash
python --version                                   # must not say 3.9
python -c "import faiss, sentence_transformers, llama_cpp; print('imports ok')"
python -m pytest tests/unit/test_device_names.py -v
```

Those tests cover the hardware naming every cross-machine comparison depends on, and until
now nothing had ever run them - CI runs no Python at all.

---

## 3. Confirm GPU support is actually compiled in

```bash
python -c "import llama_cpp; print('gpu offload:', llama_cpp.llama_supports_gpu_offload())"
```

This must print `True`, or the GPU half of every benchmark will refuse to run — the service
returns `ERR_GPU_UNAVAILABLE` rather than silently falling back to the CPU, which is correct
behaviour and also means a `False` here costs you half the data.

On Apple Silicon `True` means Metal. If it prints `False`, reinstall from the prebuilt
index:

```bash
python -m pip install llama-cpp-python --force-reinstall --no-cache-dir \
  --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/metal
```

On an NVIDIA machine the same URL ends in `/cu124` instead of `/metal`.

---

## 4. Database

```bash
python scripts/db_migrate.py up
python scripts/db_migrate.py status
```

**Check:** status prints every migration as applied. The database is `data/app.db`.

---

## 5. Models

`data/models/` does not exist yet and there is not a single `.gguf` on the machine. Without
one, `/models/active` reports nothing loaded and both the benchmark and the evaluation have
nothing to measure.

```bash
mkdir -p data/models
python -m pip install -U "huggingface_hub[cli]"

# light
hf download bartowski/Llama-3.2-3B-Instruct-GGUF Llama-3.2-3B-Instruct-Q5_K_M.gguf --local-dir data/models
hf download bartowski/Phi-3.5-mini-instruct-GGUF Phi-3.5-mini-instruct-Q4_K_M.gguf --local-dir data/models
hf download bartowski/Qwen2.5-3B-Instruct-GGUF Qwen2.5-3B-Instruct-Q4_K_M.gguf --local-dir data/models

# medium
hf download bartowski/Qwen2.5-7B-Instruct-GGUF Qwen2.5-7B-Instruct-Q4_K_M.gguf --local-dir data/models
hf download bartowski/Meta-Llama-3.1-8B-Instruct-GGUF Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf --local-dir data/models
hf download bartowski/Mistral-7B-Instruct-v0.3-GGUF Mistral-7B-Instruct-v0.3-Q4_K_M.gguf --local-dir data/models

# heavy
hf download bartowski/Qwen2.5-14B-Instruct-GGUF Qwen2.5-14B-Instruct-Q4_K_M.gguf --local-dir data/models
```

That is Samo's seven — three light, three medium, one heavy — and roughly 30 GB.

Keep `Llama-3.2-3B-Instruct-Q5_K_M.gguf` whatever else you drop: it is the hardcoded default
path, so `/query` works without setting `LOCALCHAT_LLM_MODEL`.

**Check:**

```bash
ls -lh data/models/*.gguf | wc -l
```

---

## 6. Start the service

Terminal 1, and leave it running:

```bash
cd ~/BEUMER-GROUP-LocalChat
source .venv/bin/activate
python -m uvicorn src.app:app --reload
```

**Check,** from a second terminal:

```bash
curl -s http://localhost:8000/health
curl -s http://localhost:8000/models | python3 -m json.tool | head -20
```

`/models` must list the GGUF files you just downloaded. An empty list means the service is
not looking where you put them.

---

## 7. Start the interface in live mode

Terminal 2:

```bash
cd ~/BEUMER-GROUP-LocalChat
nvm use
npm run dev:live
```

Open http://localhost:5173.

**Check — this is the important one.** Three tells that you are looking at the real service:

1. **The chat sidebar is empty.** The mock ships with "LS-4000E sorter throughput",
   "Anchor bolt torque — frame" and four others. If you can see those, you are in mock mode.
2. **Stop uvicorn and reload the page.** The status strip must go red. In mock mode the page
   looks perfectly healthy with no backend at all. Start uvicorn again afterwards.
3. **The benchmark table's Device column** will name your own hardware. The mock always says
   `Intel Core Ultra 7 165H` and `RTX A2000`.

---

## 8. Ingest the evaluation documents

The question set is 45 questions across three documents, matched by a **title substring** —
`OPNL_B01`, `OPNL_B02`, `CLV69x`. Keep the filenames as titles and the matching works.

Either drag the three files into Documents & Projects in the UI, or:

```bash
D=~/Downloads/Data
curl -X POST http://localhost:8000/ingest -F "title=OPNL_B01_EN" -F "file=@$D/OPNL_B01_EN.pdf"
curl -X POST http://localhost:8000/ingest -F "title=OPNL_B02_EN" -F "file=@$D/OPNL_B02_EN.pdf"
curl -X POST http://localhost:8000/ingest -F "title=Operating instructions CLV69x Bar code scanners" \
  -F "file=@$D/Operating_instructions_CLV69x_Bar_code_scanners_en_IM0045360.pdf"
```

Each returns a `job_id`; ingestion runs in the background.

The first ingest downloads the embedding model from HuggingFace, so **you need internet
once**. Turn Strict offline mode off for this step if it is on. After this, nothing leaves
the machine.

**Check:**

```bash
curl -s http://localhost:8000/status/1 | python3 -m json.tool
curl -s http://localhost:8000/docs | python3 -m json.tool | grep -i title
```

All three titles must be listed, and each job must reach `completed` — not `failed`.

---

## 9. Load a model and ask one question

Prove the whole path works on one question before spending hours on a benchmark.

```bash
curl -X POST http://localhost:8000/models/active \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen2.5-7B-Instruct-Q4_K_M.gguf","device":"gpu"}'
```

This blocks while the model loads — tens of seconds is normal. Then ask something the
manuals actually answer, in the UI or:

```bash
curl -X POST http://localhost:8000/query -H "Content-Type: application/json" \
  -d '{"q":"What is described in the OPNL_B01 manual?"}'
```

**Check:** an answer comes back with citations, and the citation titles are the documents
you ingested.

---

## 10. Model benchmark

From Settings → Model benchmark: pick **all installed models**, tick **CPU** and **GPU**,
press Run.

Seven models × two devices × three questions is 42 runs, each loading a model and generating
128 tokens. **Budget hours, not minutes**, and expect the 14B on CPU to be painful. Start
with two or three models if you want to see the shape first.

Two things that are correct behaviour, not bugs:

- On Apple Silicon the **Peak memory column is blank for GPU rows**. Unified memory has no
  separate VRAM pool to report, so the service sends null and the interface renders the
  absence rather than inventing a number.
- The benchmark **unloads whatever model was active** before it starts. Re-select one
  afterwards if you want to chat.

---

## 11. Embedding benchmark

Settings → Embedding benchmark → **every embedding model** → Run. CPU only by design. The
first run downloads all four models, so internet again, once.

---

## 12. Retrieval evaluation

Settings → RAG evaluation → question set `rag_qa_pairs`, project `General` → Run.

45 questions, each a full retrieval plus a generation, plus the judge pass. On a 7B model
this is a long run. Pick a small model first if you only want to see it work.

Read the summary the way it is built: **retrieval hit rate is the objective number**. The
judge verdict is the active model grading its own family's answers — a second signal, not
ground truth, which is why the expected and actual answers sit side by side for a human to
read. A question whose document was never retrieved is counted as _not judged_, not as
wrong, because there was no answer to grade.

---

## 13. Export the CSV

This is the actual deliverable. Three people exporting by hand produce three column orders
and no column saying whose machine it was, so there is a script:

```bash
python scripts/export_benchmark_csv.py --machine patrik-macbook
```

It takes the latest completed benchmark job, writes `benchmark-patrik-macbook.csv` with a
fixed column order and the machine label in the first column, and prints what it found:
devices, hardware names, models. The files concatenate.

It also refuses to be quietly wrong. It warns when the database predates the prompt sweep
(one row per model instead of three, so the rows cannot be compared with a current run),
when a measured row has no hardware name (the whole point of the chart is telling the
machines apart), when a model has fewer than three questions (an interrupted run exports
happily and looks complete in a chart), and when only one device ran.

**Read the warnings before sending the file.** Each one describes a CSV that will merge into
a chart and look fine while being wrong.

Other options: `--all-jobs` for every run in the database, `--job <id>` for a specific one,
`--out` for the filename.

### For a comparison across machines to mean anything

- **Everyone runs the same commit.** A run from before the hardware-naming or prompt-sweep
  work produces a differently shaped row.
- **Everyone runs the same model list.** The chart can only use models every machine has, so
  one person running seven and another three wastes the extra four. Agree the list before
  anyone starts.
- **Everyone runs both devices.** CPU alone is half a data point.

## Running on Windows, for the CSV only

The benchmark does not need the interface. If all you want is Samo's CSV - the CPU-vs-GPU
rows from this machine - you need Python and the service, and nothing else. No Node, no
npm, no Vite. That halves the setup and skips `npm run dev:live`, which is written in shell
syntax and does not run in PowerShell anyway.

```powershell
# Python 3.12 from python.org (tick "Add python.exe to PATH" in the installer).
# Its pyexpat is statically linked, which avoids the libexpat breakage Homebrew hit on macOS 26.
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

Check which CUDA the driver supports before picking a wheel - `nvidia-smi` prints it top
right - then install the matching prebuilt build, so pip does not try to compile
llama-cpp-python and demand Visual Studio Build Tools:

```powershell
nvidia-smi
pip install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124 -r requirements.txt
python -c "import llama_cpp; print(llama_cpp.llama_supports_gpu_offload())"   # must be True
python scripts\db_migrate.py up
```

Models into `data\models\`, then the service:

```powershell
pip install "huggingface_hub[cli]"
mkdir data\models
hf download bartowski/Llama-3.2-3B-Instruct-GGUF Llama-3.2-3B-Instruct-Q5_K_M.gguf --local-dir data\models
python -m uvicorn src.app:app
```

Drive the run from a second PowerShell window:

```powershell
$body = @{ devices = @("cpu","gpu") } | ConvertTo-Json
$job = Invoke-RestMethod -Uri http://localhost:8000/benchmark -Method Post -Body $body -ContentType application/json
$job.benchmark_job_id

# poll until status is "completed"
Invoke-RestMethod "http://localhost:8000/benchmark/status/$($job.benchmark_job_id)"
```

Add `models = @("...gguf","...gguf")` to `$body` to run a subset - the filenames exactly as
`Invoke-RestMethod http://localhost:8000/models` lists them. Then export as usual:

```powershell
python scripts\export_benchmark_csv.py --machine patrik-windows --all-jobs
```

Hardware naming works here without any of the Unix probes: `nvidia-smi` gives the GPU, and
the CPU comes from the registry's `ProcessorNameString`, which is the marketing name rather
than the `Intel64 Family 6 Model 154` string `platform.processor()` returns.

## What stays mock even in live mode

Know this before screenshotting anything for the report.

The **Compute card** — GPU name, the VRAM bar, the layer count — has no server-side home and
comes from the mock in both modes. So does theme, hotkey and the retrieval parameters. The
active model and device are real: they are read from `GET /models/active`.

**The benchmark table's Device column is the real hardware reading.** Screenshot that, not
the Compute card.

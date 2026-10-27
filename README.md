# BEUMER-GROUP-LocalChat

An offline, confidential document assistant for BEUMER Group. Documents, embeddings, model
and chat history all stay on the employee's machine.

## Repository layout

```
apps/renderer         The desktop interface (React). See docs/frontend.md.
apps/desktop          The Electron shell: window, tray, quick-ask, hardened bridge.
apps/health-service   The minimal Node HTTP service with the /health endpoint.
packages/contracts    The HTTP contract with the RAG service, as runtime schemas.
packages/tokens       The design system as CSS custom properties.
src/                  The Python RAG service (FastAPI, SQLite, FAISS).
scripts/              Migrations, benchmarks and the end-to-end demo workflow.
docker/               Review container for the interface.
```

Two runtimes live side by side: a Node/TypeScript desktop client and a Python RAG service.
The client is an npm workspaces monorepo — `npm install` at the root installs all of it.
The service is installed separately with `pip`.

**Node 22 is required** — `.nvmrc` pins it, and CI reads the same file. On Node 20 the test
runner's jsdom dependency crashes on a missing platform API, so the install is refused
outright rather than half-working. `nvm use` (or `nvm install 22`) is enough.

**Desktop client:** see [docs/frontend.md](docs/frontend.md) for how the interface is built,
how to run it against its mock service, and the Electron security posture.

---

# Desktop client

```bash
npm install
npm run dev          # interface at http://localhost:5173, no backend needed
npm run dev:desktop  # Electron shell, in a second terminal
```

Available checks:

```bash
npm test          # service tests + interface tests
npm run lint      # eslint over the client, node --check over the Node service
npm run bench
npm run verify    # everything CI runs: format, lint, typecheck, test, build
npm run demo      # Python end-to-end demo workflow, see below
```

To run the interface against the real Python service instead of its mock, see
[docs/backend-wiring.md](docs/backend-wiring.md):

```bash
npm run dev:live
```

## Node health service

A minimal HTTP service with a health endpoint, in `apps/health-service`. The root
`npm start` / `npm run bench` scripts delegate to it.

```bash
npm start
curl http://localhost:8000/health
```

Expected response:

```json
{ "status": "ok" }
```

Set `PORT` in the environment to use a different port. See `.env.example` for the
available setting.

---

# Python API and database

Install the Python dependencies, apply the SQLite migrations, and run the FastAPI service:

```bash
python -m pip install -r requirements.txt
python scripts/db_migrate.py up
pytest
python -m uvicorn src.app:app --reload
```

The database is stored locally at `data/app.db`. Use `python scripts/db_migrate.py status`
to inspect migration state or `python scripts/db_migrate.py down` to remove the application
tables.

### Docker

The same service also runs in a container, built from the root `Dockerfile` (Python 3.11,
CPU-only PyTorch to keep the image small, `llama-cpp-python` compiled from source):

```bash
docker compose up --build app
```

This applies the SQLite migrations automatically on container start and serves the API on
`http://localhost:8000`. `./data` is bind-mounted into the container at `/app/data`, so the
database, FAISS vector indexes, and GGUF models under `data/models/` all persist on the host
across container restarts — place a model there the same way as for a local run before
starting the container, or `/query` and `/models/active` will report no model loaded. Set
`PORT` in a local `.env` to change the host port, or `LOCALCHAT_LLM_MODEL` to point at a
non-default model path. Loading the embedding model and any local LLM is memory-intensive;
make sure Docker has enough RAM allocated (Docker Desktop → Settings → Resources).

This is a review/local target, not the shipping artefact — see the note at the top of
`docker-compose.yml`.

For CUDA vs Vulkan prerequisites — what each backend needs on the host, what permissions are
required, and what Docker can and can't automate — see
[docs/gpu-setup.md](docs/gpu-setup.md).

## Ingestion

Upload a supported PDF, Word (.docx), Markdown, or TXT document with:

```bash
curl -X POST http://localhost:8000/ingest -F "title=Project guide" -F "file=@path/to/guide.txt"
```

The response contains a `job_id`. Poll its progress with `GET /status/{job_id}`. On
completion, the document chunks are stored in SQLite and the FAISS index is written to
`data/vectors/{document_id}.index`.

## Querying

```bash
curl -X POST http://localhost:8000/query -H "Content-Type: application/json" -d "{\"q\":\"What is in the project guide?\"}"
```

Place the Llama-3.2-3B-Instruct Q5_K_M GGUF at
`data/models/Llama-3.2-3B-Instruct-Q5_K_M.gguf`, or set `LOCALCHAT_LLM_MODEL` to its local
path before starting the API. The model is loaded once at startup and runs with
`n_gpu_layers=0`.

## Chat history (conversations)

Questions and answers can be persisted as threaded conversations, each holding its own
ordered sequence of user/assistant messages (title auto-generated from the first question,
or renamed explicitly):

```bash
# Start a new conversation (title is optional; omit it to auto-generate from the first question)
curl -X POST http://localhost:8000/conversations -H "Content-Type: application/json" -d "{\"title\":\"Conveyor questions\"}"

# Ask a question inside that conversation. This runs the same RAG flow as /query,
# then stores both the user question and the assistant's answer as messages.
curl -X POST http://localhost:8000/conversations/1/messages -H "Content-Type: application/json" -d "{\"q\":\"What is the conveyor speed?\"}"

# List conversations (most recently active first), for a sidebar-style history view
curl http://localhost:8000/conversations

# Fetch one conversation with its full message thread
curl http://localhost:8000/conversations/1

# Rename a conversation
curl -X PATCH http://localhost:8000/conversations/1 -H "Content-Type: application/json" -d "{\"title\":\"Safety questions\"}"

# Delete a conversation (its messages are removed too)
curl -X DELETE http://localhost:8000/conversations/1
```

Conversations and messages are stored in the same SQLite database (`conversations` and
`messages` tables) as everything else in `data/app.db`; they are pure persistence around the
existing RAG pipeline and do not change how answers are generated.

## End-to-end workflow test

Run the opt-in real end-to-end workflow test after installing `llama-cpp-python` and placing
the GGUF model:

```powershell
$env:LOCALCHAT_RUN_REAL_E2E = "1"
$env:LOCALCHAT_LLM_MODEL = "C:\path\to\Llama-3.2-3B-Instruct-Q5_K_M.gguf"
py -m pytest tests/integration/test_real_workflow_e2e.py -s
```

This test uses real SQLite, chunking, Nomic embeddings, FAISS retrieval, and Llama-3.2
generation. It is skipped unless explicitly enabled because it loads the local
multi-gigabyte model.

## Model selection and device (research/eval tooling)

`/query` and `/conversations/*/messages` always answer using whatever model is currently
active, not a per-request choice. List the GGUF files available in `data/models/` and manage
the active model with:

```bash
# List available GGUF models
curl http://localhost:8000/models

# See what's currently loaded (null/null if nothing has been activated yet)
curl http://localhost:8000/models/active

# Load a model onto a device. This blocks until the swap is complete (unload the
# current model, load the requested one, ready to answer) and returns the confirmed
# active selection - there is no separate "loading" status to poll.
curl -X POST http://localhost:8000/models/active -H "Content-Type: application/json" \
  -d "{\"model\":\"Qwen2.5-0.5B-Instruct-Q5_K_M.gguf\",\"device\":\"cpu\"}"
```

`device` is `"cpu"` or `"gpu"`. Requesting `"gpu"` returns `422 ERR_GPU_UNAVAILABLE` with a
clear message when the installed `llama-cpp-python` build has no CUDA/GPU offload support,
instead of silently falling back to CPU. An unknown model name returns `404 ERR_NOT_FOUND`.

## Benchmarking (research/eval tooling)

Benchmarks run as a background job, mirroring `/ingest`'s job pattern (kick off, poll
status, fetch results) rather than blocking a request:

```bash
# Kick off a benchmark. "models" is optional - omit it to benchmark every GGUF in data/models/.
curl -X POST http://localhost:8000/benchmark -H "Content-Type: application/json" \
  -d "{\"devices\":[\"cpu\",\"gpu\"],\"models\":[\"Qwen2.5-0.5B-Instruct-Q5_K_M.gguf\"]}"

# Poll progress
curl http://localhost:8000/benchmark/status/1

# Full metrics table for that run, once complete
curl http://localhost:8000/benchmark/results/1

# All past benchmark runs
curl http://localhost:8000/benchmark/results
```

Each result row records `model`, `device`, `device_name`, `load_s`, `ttft_s`, `gen_tokens`,
`tok_s`, `total_s`, `peak_mem_mb`, and `peak_vram_mb` (GPU rows only). Rows are written to
the `eval_results` table (via the `EvalResult` model), keyed by `benchmark_job_id`, so
results are queryable and persist across restarts instead of living in loose CSV/JSON files.

Before benchmarking, the job unloads whatever model `/models/active` currently has loaded,
so the two features don't compete for the same RAM/VRAM - re-select a model with
`POST /models/active` afterward if you need `/query` live again.

Model-switching and benchmarking are research/evaluation tooling for comparing local models,
not part of the deployed staff-facing assistant surface - they're deliberately
functional-over-polished.

### Danish and English model selection

Embedding models can be language-sensitive. A model may represent English text very well but
produce weaker similarity results for Danish. The same applies to answer-generation models:
their understanding and writing quality can differ between languages.

Embedding models suitable for Danish and English include:

- `intfloat/multilingual-e5-base` or `intfloat/multilingual-e5-large`: strong multilingual
  retrieval. Use the `query: ` prefix for questions and `passage: ` for documents.
- `BAAI/bge-m3`: multilingual, including Danish, and a good choice for corpora containing
  multiple languages.
- `sentence-transformers/paraphrase-multilingual-mpnet-base-v2`: good general multilingual
  semantic similarity.
- `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`: smaller and faster, usually
  with a lower quality ceiling than larger models.

The currently configured models, including `BAAI/bge-small-en-v1.5`, `intfloat/e5-base-v2`,
and `sentence-transformers/all-MiniLM-L6-v2`, are primarily English-oriented. They may work
with Danish, but they are not the safest choices for Danish retrieval. The embedding model
configuration lives in `config/embedding_models.json`; changing the active model requires
re-embedding the existing corpus before retrieval results can be trusted.

LLMs suitable for Danish and English include:

- **Qwen2.5 Instruct**: strong general multilingual capability, including Danish, and a
  practical choice for local inference.
- **Aya Expanse**: specifically designed for multilingual use and useful when Danish quality
  matters more than using the smallest model possible.
- **Gemma 2 or Gemma 3**: good English and reasonable multilingual capability, including Danish.
- **Llama 3.1/3.2 Instruct**: strong English and usable Danish, although Danish quality varies
  with model size.
- **EuroLLM**: focused on European languages and worth testing for Danish-heavy applications.

Model size matters: a 7B or 8B model will generally handle Danish better than a tiny 1B or 3B
model, while quantization and hardware affect speed and memory use. A practical starting point
for this application is:

```text
Embedding: intfloat/multilingual-e5-base
LLM: Qwen2.5-7B-Instruct
```

Evaluate Danish and English questions separately. Speed benchmarks only measure performance;
they do not prove that retrieval or answers are accurate. The RAG evaluation should report
separate Danish and English results for retrieval hit rate, answer correctness, and citation
accuracy. The repository already includes a Danish cross-lingual dataset at
`data/eval/rag_qa_pairs_da.md`.

## Vector DB capacity sweep (research/eval tooling)

Answers a different question than the benchmarks above: not "how fast is this model", but
"how does the vector store hold up as the number of ingested _documents_ grows". Runnable as
a background job from Settings > Benchmarks in the app, or standalone:

```bash
python scripts/vector_capacity_sweep.py
python scripts/vector_capacity_sweep.py --steps 1000 5000 20000 --queries-per-step 10
```

or via the API, mirroring the job pattern above:

```bash
curl -X POST http://localhost:8000/vector-capacity/benchmark
curl http://localhost:8000/vector-capacity/benchmark/status/1
curl http://localhost:8000/vector-capacity/benchmark/results/1
```

It inserts synthetic documents with fake, correctly-dimensioned embeddings (standing in for
sentence-transformers, so the run isn't dominated by embedding speed) through the real
ingestion pipeline, into a throwaway database and vector directory that are discarded once
the run's summary numbers are recorded - your real corpus is never touched. See
`src/vector_capacity_benchmark.py` for the full rationale.

**What this measures is a degradation curve, not a capacity ceiling.** `src/ingest/vector_store.py`
keeps one FAISS index file per document rather than one shared index, and every query
(`src/retriever.py`) globs and loads _all_ of them before merging results. That design has no
hard wall to hit - given enough disk and RAM you could keep inserting documents indefinitely,
and neither SQLite nor FAISS individually have a practical ceiling anywhere near what matters
here. It just keeps getting slower, continuously, the more documents are indexed. So "maximum
capacity" as a single crash point doesn't really apply to this architecture.

What _does_ apply, and what a sweep's numbers answer, is: at what document count does the
system cross from usable to unusable? One real run:

| Documents | Mean query latency |
| --------- | ------------------ |
| 100       | 0.3s               |
| 500       | 1.1s               |
| 1,000     | 3.6s               |
| 2,500     | 16.5s              |
| 5,000     | 58.8s              |

Document count grew 50x over this run; mean latency grew ~197x - worse than linear, confirming
the glob-and-merge design degrades faster than document count alone would predict. For an
interactive chat UI, anything past a couple of seconds is already unusable, which puts the
practical ceiling somewhere between 500 and 1,000 documents on this machine - far below where
anything actually breaks. Treat that crossing point, not a crash, as "capacity" for this system.

## Retrieval settings and the conversation benchmark (research/eval tooling)

How a question finds its passages is controlled by `src/rag_config.py`. Every setting keeps
the previous behaviour reachable, so a change can be measured against what it replaced:

| Setting | Default | Previous behaviour | Env var |
| --- | --- | --- | --- |
| History given to the query rewriter | `compact`: only the subject of each earlier question (e.g. "What is the max throughput of the CrisBelt?" becomes "CrisBelt") and the first sentence of each earlier answer | `full`: every turn verbatim | `LOCALCHAT_HISTORY_MODE` |
| Searching a rewritten follow-up | `rrf`: search the rewrite **and** the user's own words, merge with reciprocal rank fusion (k=60) | `fallback`: search the rewrite, retry the original only if nothing is found | `LOCALCHAT_FUSION` |
| Search type | hybrid: BM25 keyword search + vector search, merged with RRF | vector only | `LOCALCHAT_HYBRID` |
| How many passages the model reads | `adaptive`: fetch 10, keep those scoring at least 85% of the best, minimum 2 and maximum 8 | `tiered`: guessed from the question's complexity | `LOCALCHAT_SELECTION` |

Adaptive selection examples: scores 0.82 / 0.51 / 0.48 / 0.45 keep 2 passages (only 0.82
clears 0.85 × 0.82 = 0.70, then padded to the minimum). Scores 0.71 / 0.69 / 0.68 / 0.66 /
0.64 keep all five (cutoff 0.60). Each `/query` and conversation answer now reports this in
a `retrieval` block: candidates, best score, cutoff and how many passages were kept.

`scripts/conversation_benchmark.py` compares these settings on the demo corpus. It ingests
`data/demo-inputs/` into a throwaway database under `data/eval_runs/<timestamp>/`, then runs:

- **Conversations** (`data/eval/conversations/demo_conversations.json`): 22 scripted
  conversations, 89 turns. Turns are standalone, follow-ups ("And its battery?"), topic
  switches, or unanswerable. They are replayed with history and focus document built exactly
  as the API builds them.
- **Single questions** (`data/eval/demo_qa_pairs.json`, readable as `demo_qa_pairs.md`):
  146 English questions. Each is tagged by difficulty (38 easy / 71 medium / 37 hard) and
  type (fact, numeric, list, procedure, conditional, reasoning, multi-doc, unanswerable).
  The file also appears as a dataset in the app's RAG evaluation.

Each variant is a full settings combination: `baseline` (before these changes), `improved`
(the defaults), and one variant per change with only that change undone. Every turn is
scored on what retrieval handed the model. A source hit means a passage came from the right
document. An evidence hit means the passages contain the answer's key phrases. Precision is
the share of passages from the right document. `--answers` also generates every turn and
has the active model grade it against a reference answer.

```bash
python scripts/conversation_benchmark.py                                  # retrieval scores only
python scripts/conversation_benchmark.py --answers --device gpu           # + generated, judged answers
python scripts/conversation_benchmark.py --variants baseline improved --skip-questions
python scripts/conversation_benchmark.py --answers --device gpu --judge-model Qwen2.5-7B-Instruct-Q5_K_M.gguf
```

Use `--judge-model` when generating answers. Llama 3.2 3B grading its own answers called
most correct answers "incorrect", so its verdicts were noise.

One run (Llama 3.2 3B answering on an RTX 2070, Qwen2.5 7B judging):

| | Baseline | Improved |
| --- | --- | --- |
| Follow-up turns: right document among the passages | 89.8% | 96.6% |
| Follow-up turns: answer's key phrases among the passages | 83.0% | 93.2% |
| Follow-up turns: passages given to the model (mean) | 3.3 | 4.9 |
| Follow-up turns: share of passages from the right document | 40.1% | 37.5% |
| All turns: judged correct or partial | 79.3% | 84.7% |
| Single questions: answer's key phrases among the passages | 91.8% | 97.0% |

The demo corpus is small (12 documents, 16 passages). Single-passage documents always share
the minimum of 2 passages with another document, which keeps precision low for every
variant. Re-run on the real manuals before drawing conclusions about the 85% cutoff.

## Demo workflow

`npm run demo` runs an isolated end-to-end simulation and prints each stage clearly: health
check, document ingestion, ingestion status, database and FAISS vector verification,
relevant query answer, and unrelated query fallback. Artifacts are written to
`data/demo_runs/<timestamp>/`.

You can pass your own questions:

```bash
npm run demo -- --relevant-question "How often do emergency stop checks run?" --unrelated-question "Who won the World Cup in 2018?"
```

For the built-in demo document, a relevant question is one about conveyor speed or emergency
stop checks.

You can also run the same demo flow on your own file (.pdf, .docx, .md, .txt):

```bash
npm run demo -- --demo-file "data/demo-inputs/site-guide.txt" --demo-title "Site Guide" --relevant-question "What is the emergency protocol?"
```

If `--relevant-question` is omitted for a custom file, the demo asks:
`What are the main points in this document?`

> The `demo` script invokes `py`, the Windows Python launcher. On macOS and Linux run
> `python3 scripts/demo_workflow.py` directly until the script is made portable.

---

# Jira & GitHub workflow

This repository includes GitHub Actions that enforce and integrate Jira issue keys across
branches, PRs and commits.

- **Branch naming:** Branches must be named like `LCHAT-123-short-description` (case-insensitive letters, dashes).
- **PR titles:** PR titles must contain the Jira key (e.g. `LCHAT-123`). This check is case-sensitive — `Lchat-123` fails.
- **Commit messages:** Commits in a PR should start with the Jira key (e.g. `LCHAT-123 Fix typo`).
- **Automatic PR enrichment:** PR bodies are automatically updated with a clickable Jira link.
- **Automatic transitions:** Jira issues are transitioned to `In Review` on PR open and to `Done` on merge (edit transitions in the workflow if your board uses different names).

Workflows:

- `.github/workflows/ci.yml` — installs dependencies, lints, tests and benchmarks.
- `.github/workflows/frontend.yml` — format, lint, typecheck, test and build the desktop client.
- `.github/workflows/jira-pr-link.yml` — adds Jira link to PRs.
- `.github/workflows/enforce-jira-key.yml` — validates branch name and PR title.
- `.github/workflows/enforce-commit-jira-key.yml` — validates PR commit messages start with the Jira key.
- `.github/workflows/enforce-push-commit-jira-key.yml` — validates pushed commit messages start with the Jira key.
- `.github/workflows/jira-auto-transition.yml` — transitions Jira issues on PR open/merge.

Quick branch / PR commands:

```bash
git checkout -b LCHAT-123-add-login-page
git commit -m "LCHAT-123 Add login page"
git push origin LCHAT-123-add-login-page
# create a PR as normal from GitHub UI
```

Enable branch protection (one-time):

1. Go to the GitHub repository → Settings → Branches.
2. Edit the `main` branch protection rule.
3. Enable **Require status checks to pass before merging**.
4. Select the checks named `Enforce Jira Key / validate`, `Enforce Jira Commit Key / validate-commits`, and `Enforce Jira Commit Key On Push / validate-push-commits` (they appear after the actions run once).

Jira connection (one-time):

1. In Jira Cloud: Settings → Products → GitHub.
2. Connect your GitHub organization/repository.
3. Verify branches, commits and PRs appear in the Jira Development panel.

GitHub repository configuration (for Jira workflows):

1. Add repository variable `JIRA_BASE_URL` (example: `https://your-company.atlassian.net`).
2. Add repository secret `JIRA_EMAIL` (Jira account email).
3. Add repository secret `JIRA_API_TOKEN` (Jira API token).
4. Optional: add repository variables `JIRA_TRANSITION_IN_REVIEW` and `JIRA_TRANSITION_DONE` if your Jira transition names differ from defaults.

Customization:

- To change transition names, edit `.github/workflows/jira-auto-transition.yml` and replace `In Review` / `Done` with your Jira workflow transitions.
- To require different commit/branch patterns, edit the respective workflow regexes in the `.github/workflows` folder.

Local commit-time enforcement (recommended):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-git-hooks.ps1
```

On macOS and Linux:

```bash
git config core.hooksPath .githooks && chmod +x .githooks/commit-msg
```

This enables the committed hook at `.githooks/commit-msg`, which blocks commits unless the
first line starts with `LCHAT-123`.

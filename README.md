# BEUMER-GROUP-LocalChat

## Local service

This repository includes a minimal HTTP service with a health endpoint.

### Run locally

```bash
npm install
npm start
```

The service listens on `http://localhost:8000` by default. Verify it with:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

## Python API and database

Install the Python dependencies, apply the SQLite migrations, and run the FastAPI service:

```bash
python -m pip install -r requirements.txt
python scripts/db_migrate.py up
pytest
python -m uvicorn src.app:app --reload
```

The database is stored locally at `data/app.db`. Use `python scripts/db_migrate.py status` to inspect migration state or `python scripts/db_migrate.py down` to remove the application tables.

Upload a supported PDF, Word (.docx), Markdown, or TXT document with:

```bash
curl -X POST http://localhost:8000/ingest -F "title=Project guide" -F "file=@path/to/guide.txt"
```

The response contains a `job_id`. Poll its progress with `GET /status/{job_id}`. On completion, the document chunks are stored in SQLite and the FAISS index is written to `data/vectors/{document_id}.index`.

Query the indexed documents with:

```bash
curl -X POST http://localhost:8000/query -H "Content-Type: application/json" -d "{\"q\":\"What is in the project guide?\"}"
```

Place the Llama-3.2-3B-Instruct Q5_K_M GGUF at `data/models/Llama-3.2-3B-Instruct-Q5_K_M.gguf`, or set `LOCALCHAT_LLM_MODEL` to its local path before starting the API. The model is loaded once at startup and runs with `n_gpu_layers=0`.

### Chat history (conversations)

Questions and answers can be persisted as threaded conversations, each holding its own ordered sequence of user/assistant messages (title auto-generated from the first question, or renamed explicitly):

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

Conversations and messages are stored in the same SQLite database (`conversations` and `messages` tables) as everything else in `data/app.db`; they are pure persistence around the existing RAG pipeline and do not change how answers are generated.

Run the opt-in real end-to-end workflow test after installing `llama-cpp-python` and placing the GGUF model:

```powershell
$env:LOCALCHAT_RUN_REAL_E2E = "1"
$env:LOCALCHAT_LLM_MODEL = "C:\path\to\Llama-3.2-3B-Instruct-Q5_K_M.gguf"
py -m pytest tests/integration/test_real_workflow_e2e.py -s
```

This test uses real SQLite, chunking, Nomic embeddings, FAISS retrieval, and Llama-3.2 generation. It is skipped unless explicitly enabled because it loads the local multi-gigabyte model.

Available checks:

```bash
npm test
npm run lint
npm run bench
npm run demo
```

The demo command runs an isolated end-to-end simulation and prints each stage clearly: health check, document ingestion, ingestion status, database and FAISS vector verification, relevant query answer, and unrelated query fallback. Artifacts are written to `data/demo_runs/<timestamp>/`.

You can pass your own questions when running the demo:

```bash
npm run demo -- --relevant-question "How often do emergency stop checks run?" --unrelated-question "Who won the World Cup in 2018?"
```

For this built-in demo document, a relevant question is one about conveyor speed or emergency stop checks.

You can also run the same demo flow on your own file (.pdf, .docx, .md, .txt):

```bash
npm run demo -- --demo-file "data/demo-inputs/site-guide.txt" --demo-title "Site Guide" --relevant-question "What is the emergency protocol?"
```

If `--relevant-question` is omitted for a custom file, the demo asks: `What are the main points in this document?`

Set `PORT` in the environment to use a different port. See `.env.example` for the available setting.

## Jira & GitHub workflow

This repository includes GitHub Actions that enforce and integrate Jira issue keys across branches, PRs and commits.

- **Branch naming:** Branches must be named like `LCHAT-123-short-description` (case-insensitive letters, dashes).
- **PR titles:** PR titles must contain the Jira key (e.g. `LCHAT-123`).
- **Commit messages:** Commits in a PR should start with the Jira key (e.g. `LCHAT-123 Fix typo`).
- **Automatic PR enrichment:** PR bodies are automatically updated with a clickable Jira link.
- **Automatic transitions:** Jira issues are transitioned to `In Review` on PR open and to `Done` on merge (edit transitions in the workflow if your board uses different names).

Workflows added:

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

To enforce Jira commit prefixes on every local commit, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-git-hooks.ps1
```

This enables the committed hook at `.githooks/commit-msg`, which blocks commits unless the first line starts with `LCHAT-123`.

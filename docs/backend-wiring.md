# Wiring the desktop client to the RAG service

The interface can run against two backends. Which one is chosen is baked in at build time
by `LOCALCHAT_SERVICE`:

```bash
npm run dev        # mock — no Python, no model, no GPU. The default, and what CI runs.
npm run dev:live   # the FastAPI service on http://127.0.0.1:8000
```

Nothing auto-detects. A UI that silently falls back to fixtures when the service is down is
the worst of both worlds: it looks like it works, and the numbers on screen are invented.

## Running the live pair

```bash
# terminal 1 — the service
python -m pip install -r requirements.txt
python scripts/db_migrate.py up
python -m uvicorn src.app:app --reload

# terminal 2 — the interface
npm run dev:live

# terminal 3 — the Electron shell, optional
npm run dev:desktop
```

Answering needs a GGUF at `data/models/`. Everything else — the document list, ingestion,
conversation history — works without one.

## Testing the adapter without the service

The client's own tests assert that the mappers are correct; they cannot assert that the
service agrees. `scripts/stub_service.py` closes that gap. It serves the service's routes in
the service's shapes — snake_case keys, integer ids, naive UTC datetimes, the
`{code, message, details}` error envelope — using nothing but the standard library.

```bash
python3 scripts/stub_service.py    # no venv, no dependencies, any Python 3.8+
npm run dev:live                   # in another terminal
```

It exists because the real service's dependency tree is heavy — FAISS, PyTorch through
`sentence-transformers`, and a compiled `llama-cpp-python` — and none of it is needed to
find out whether the adapter reads the wire format correctly.

This is a development tool. It is never shipped, never imported by the app and never
started automatically, and it is not a second mock of the product: the MSW mock exists so
the interface can be built with no backend, this exists so the adapter can be checked
against a contract. **If the stub and the real service ever disagree, the real service is
right and the stub is out of date.**

## What is wired

| Screen                   | Service endpoint                         | Notes                                           |
| ------------------------ | ---------------------------------------- | ----------------------------------------------- |
| Status strip             | `GET /health` + `GET /models/active`     | Second call only to tell "up" from "can answer" |
| Document list            | `GET /docs`                              |                                                 |
| Remove a document        | `DELETE /docs/{id}`                      |                                                 |
| Add documents            | `POST /ingest` → `GET /status/{job_id}`  | Multipart upload; polls to completion           |
| Chat sidebar and history | `GET /conversations`                     |                                                 |
| Open a chat              | `GET /conversations/{id}`                |                                                 |
| New chat                 | `POST /conversations`                    | Title auto-generated from the first question    |
| Rename / delete          | `PATCH` / `DELETE /conversations/{id}`   |                                                 |
| Ask a question           | `POST /conversations/{id}/messages`      |                                                 |
| Model picker             | `GET /models`, `GET/POST /models/active` | The swap blocks; expect tens of seconds         |

## What is not wired, and why

**Projects.** The service has no project entity — only a `project: bool` flag on ingest.
Agreed as out of scope for this pass. The projects screens stay wholly on fixtures: asking
the live client for a project's documents returns an empty list rather than the whole corpus
mislabelled as belonging to that project, and ingesting _from_ a project page goes to the
mock as well, because uploading to the service's single corpus would put the file somewhere
that page cannot show it.

**So in live mode, add documents from the chat screen's context widget, not from a project.**
That is the general corpus, and it is the one backed by `POST /ingest`.

**Retrieval evaluation.** The benchmark that _is_ wired measures models, not retrieval:
`src/benchmark.py` uses one hardcoded question with its context pasted inline, and never
touches the index, the corpus or FAISS. It answers "which model can this machine run, and
how fast", which is what decides the model we ship.

It does not answer "does the system find the right passage", and nothing on screen should
be read as if it did. That measurement — answers carrying a citation, whether the expected
document was retrieved, latency over a real question set — needs three things the project
does not yet have:

1. **A question set.** Roughly 30 questions over a frozen corpus, each with the document
   that should be cited. This is the long pole and it is not code; it can be written now,
   in parallel with everything else.
2. **An endpoint** that runs each question through `answer()` and records retrieval time,
   generation time, whether a citation came back, and whether the expected document was in
   the top-k.
3. **Somewhere to put the rows.** `eval_results` was the natural home, but migration 0008
   repurposed it for benchmark throughput rows, so this needs its own table.

Keep the two named apart — **model benchmark** and **retrieval evaluation** — or the report
will conflate them.

**Most of settings.** Theme, hotkey, launch-on-startup, retrieval parameters and hardware
have no server-side home. Only the model and device swap reaches the service.

**Retrieval scope.** `POST /query` accepts a question and nothing else — no scope, no
document filter, and `top_k` is a Python-side default. The scope control still works and
still records the engineer's choice, but that choice does not yet reach the retriever.

## Where the two contracts disagree

All of it lives in `apps/renderer/src/shared/api/service/`, and nowhere else:

- `dto.ts` — the service's wire shapes, exactly as FastAPI emits them.
- `map.ts` — pure translation into the domain contract. Every function is total and
  side-effect free, which is why this is the file with the tests.
- `index.ts` — the endpoint calls.

`packages/contracts` stays the vocabulary the interface thinks in. When the service changes,
one directory changes.

The rule these mappers follow: **where the service cannot supply a field, produce the honest
empty value, never a plausible-looking guess.** A fabricated page number in a citation is
worse than a missing one, because the entire product promise is that a number on screen can
be checked against paper.

Concretely, that means the live client reports chunk counts as `0`, file sizes as `0`,
context lengths as unknown, and retrieval/generation timings as absent — because the service
does not send them.

## Asks for the service, in order of value

0. **Install `CORSMiddleware`.** `src/app.py` has none, so a browser refuses every
   cross-origin call to the service before sending it. Development works around this by
   proxying through the Vite dev server, but the packaged app loads from `app://` and has
   no proxy — it cannot talk to the service at all until this exists.

   ```python
   from fastapi.middleware.cors import CORSMiddleware

   app.add_middleware(
       CORSMiddleware,
       allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "app://localchat"],
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

   An explicit list rather than `["*"]`: this service answers on loopback with the
   employee's whole document corpus behind it, so any page the engineer happens to have
   open should not be able to read it.

1. **Stream the answer.** `POST /conversations/{id}/messages` generates all 512 tokens
   before responding. On a 3B model on CPU that is a long silent window, and the client
   already speaks server-sent events end to end. The retrieval step could emit citations
   first, then tokens.

2. **Put a `document_id` on each citation.** `rag_service.answer()` builds citations from
   the retrieved chunk and keeps `{title, section, page, score}`. Without an id the only
   route back to the document is the title, which the client resolves where it can and
   gives up on when two documents share one. Two lines in `rag_service.py`.

3. **Pass the conversation into retrieval.** `post_message` stores the thread, then calls
   `answer(question, db)` without it — so prior turns never reach the retriever or the
   prompt. Requirement 8 looks satisfied from the outside and is not.

4. **Distinguish the two refusals.** `not_found` is returned both when nothing was
   retrieved and when the best score fell below `MIN_SIMILARITY`. The client currently
   reports the weaker of the two, because asserting the stronger one would be false on an
   empty corpus.

5. **Report benchmark progress as numbers.** `/benchmark/status/{id}` returns `progress`
   pre-formatted as `"3 of 6"`, so the client renders the string verbatim rather than a
   progress bar. `completed_runs` and `total_runs` as integers would be a two-line change.

6. **Return the chunk text on a citation.** Without it there is no "show me the source
   passage" affordance, only a page reference.

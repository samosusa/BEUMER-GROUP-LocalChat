# BEUMER LocalChat — desktop client

The user interface for LocalChat: an offline, confidential document assistant that runs
entirely on an engineer's machine. Windows tray application, built with Electron and React.

The product's whole argument is traceability. Every factual claim in an answer carries a
citation — document, section, page and revision — and when the retriever finds nothing, the
app says so rather than guessing. Everything in this repository is arranged to keep that
promise visible in the interface.

---

## Getting started

```bash
npm install          # Node 20.19+ or 22+
npm run dev          # UI at http://localhost:5173, against the mock service
npm run dev:desktop  # the same UI inside the Electron shell
```

There is no backend to run. In development the renderer boots an in-process mock of the RAG
service (MSW), so the whole interface — streaming answers, ingestion progress, benchmarks —
is exercisable on any laptop with no model and no GPU.

### Review container

```bash
docker compose up --build ui     # http://localhost:8080
```

Serves a production build with the mock service still in it, so a supervisor or a product
owner can open the interface in a browser without installing anything. It is a review target,
not the shipping artefact — the product ships as the installer from `npm run package`.

### Everything else

```bash
npm run verify       # format check → lint → typecheck → tests → build. What CI runs.
npm run test         # Vitest
npm run build:desktop
npm run package      # Windows NSIS installer → apps/desktop/release
```

---

## Structure

```
packages/contracts    The HTTP contract with the RAG service, as Zod schemas.
packages/tokens       The design system as CSS custom properties.
apps/renderer         The React UI. Runs in Electron, or in a browser against the mock.
apps/desktop          Electron main process, preload bridge, tray, quick-ask window.
docker/               Review container.
```

### Why it is split this way

**`packages/contracts` is the seam between this repository and the Python service.** It holds
the domain vocabulary (`Document`, `Citation`, `RetrievalScope`…) and the request/response
shape of every endpoint, as runtime schemas rather than types alone. The client parses every
response through them, so a backend that drifts from the contract fails loudly at the
boundary instead of silently rendering a half-empty answer to someone standing next to a
running sorter. The FastAPI service implements this file; nothing else negotiates.

**The renderer is organised by feature, not by file type.** `features/chat` owns the chat
screen and everything only the chat screen needs. `shared/` holds what genuinely crosses
features: the transport layer, the UI primitives, formatting. A new screen is a new folder,
not an edit to six shared directories.

**Server state and client state are separate on purpose.** Anything the service owns lives in
React Query, keyed hierarchically so an invalidation targets exactly what changed. Anything
only the UI cares about — theme, whether the context panel is open — lives in a small Zustand
store. Nothing is duplicated between them, which is what stops two sources of truth for the
same document list appearing.

**The design system is CSS custom properties.** Components reference semantic tokens
(`--surface-raised`, `--accent-text`), never a hex value, so both themes are one attribute on
`<html>` and the system is a file you can point at in the report.

### Where the interesting decisions are

| Decision                                              | Where                                         | Why                                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Answers stream as typed SSE events                    | `shared/api/client.ts`                        | Retrieval finishes seconds before the last token. Naming the documents being read is the difference between a UI that feels stalled and one that feels like it is working. |
| Model output is parsed, never `innerHTML`             | `features/chat/lib/answerMarkup.tsx`          | A document containing `<img onerror=…>` renders as the characters an engineer typed.                                                                                       |
| Tool results are structurally separate from citations | `contracts/domain.ts`, `AssistantMessage.tsx` | A value from an MCP tool must be impossible to mistake for something a document said.                                                                                      |
| Scope changes are optimistic                          | `shared/api/queries.ts`                       | The engineer flips scope mid-thought; a spinner there reads as the app second-guessing them.                                                                               |
| Renderer is sandboxed with a five-function bridge     | `apps/desktop/src/preload`                    | See `apps/desktop/README.md` for the full security posture.                                                                                                                |
| Removing a document from context is undoable          | `features/chat/components/UndoToast.tsx`      | Context is cheap to destroy by accident and expensive to rebuild.                                                                                                          |

---

## The mock service

`apps/renderer/src/mocks` is a stateful in-memory implementation of the contract: creating a
chat, flipping scope and asking a question all mutate it, and ingestion progresses on a timer.
Answers are canned but cover the three states that are hard to build against — a grounded
answer with figures, a refusal, and a refusal partially rescued by an approved tool.

It exists behind a build-time flag (`__USE_MOCKS__`), so the production bundle tree-shakes it
away entirely. When the FastAPI service lands, this directory is the only thing that is
deleted; nothing above the transport layer knows it was ever there.

---

## What is not built yet

- The FastAPI RAG service. The contract is defined and mocked; the implementation is not here.
- Process supervision for that service — the shell currently observes its health rather than
  owning its lifecycle (`apps/desktop/src/main/service.ts`).
- Code signing. Windows SmartScreen will warn on first run until BEUMER provides a
  certificate; worth raising before any pilot rollout.
- Scope note: the approved project description delimits the interface to a simple chat window.
  Projects, the tray application and the quick-ask window go beyond that, and should be
  recorded as agreed scope changes rather than assumed.

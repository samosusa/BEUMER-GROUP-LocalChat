#!/usr/bin/env python3
"""
A contract conformance stub for the RAG service.

WHAT THIS IS FOR
----------------
The desktop client's live mode translates between the domain contract and whatever
FastAPI actually puts on the wire. That translation is the part most likely to be wrong,
and it cannot be exercised by the client's own tests: those assert the mapping is correct,
not that the service agrees.

This serves the real service's routes, in the real shapes — snake_case keys, integer
primary keys, naive UTC datetimes, the {code, message, details} error envelope — using
nothing but the standard library. It starts instantly and needs no model, no torch, no
FAISS and no compiled extension, so the wiring can be tested end to end while the real
dependencies are still downloading.

WHAT THIS IS NOT
----------------
Not a second mock of the product, and not a fallback. The renderer's MSW mock exists so
the interface can be developed with no backend; this exists so the *adapter* can be
checked against the service's contract. It is a development tool and is never shipped,
never imported by the app, and never started automatically.

If this stub and the real service disagree, the real service is right and this file is
out of date.

    python3 scripts/stub_service.py            # http://127.0.0.1:8000
    python3 scripts/stub_service.py --port 8001
"""

from __future__ import annotations

import argparse
import json
import re
import platform
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

# Matches src/rag_service.py
MIN_SIMILARITY = 0.35
CHUNKS_PER_DOCUMENT = 24
# Long enough that the client's polling loop and progress states are actually exercised.
SECONDS_PER_CHUNK = 0.06


def now() -> str:
    """FastAPI serialises the service's naive UTC datetimes without a designator."""
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


class State:
    """In-memory stand-in for data/app.db. Reset by restarting the process."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.documents: list[dict] = []
        self.conversations: list[dict] = []
        self.messages: list[dict] = []
        self.jobs: dict[int, dict] = {}
        # document id -> parsed sections, so answers can come out of the real file
        self.sections: dict[int, list] = {}
        self.benchmark_jobs: dict[int, dict] = {}
        self.active = {"model": None, "device": None}
        self._next = {"document": 1, "conversation": 1, "message": 1, "job": 1, "benchmark": 1}

    def id_for(self, kind: str) -> int:
        value = self._next[kind]
        self._next[kind] = value + 1
        return value


state = State()

REFUSAL = {
    "answer": None,
    "citations": [],
    "not_found": True,
    "suggestion": "Try a more specific question about the ingested project documentation.",
}

# The stub has no GPU offload, exactly like a llama-cpp-python installed without CUDA —
# which is the common laptop case and the one the interface has to handle.
GPU_AVAILABLE = False

# Roughly what a 0.5B and a 3B model do on a laptop CPU, so the table has a real spread.
BENCHMARK_PROFILE = {
    "Llama-3.2-3B-Instruct-Q5_K_M.gguf": {"load_s": 4.18, "ttft_s": 1.92, "tok_s": 7.4, "mem": 2480.0},
    "Qwen2.5-0.5B-Instruct-Q5_K_M.gguf": {"load_s": 0.86, "ttft_s": 0.31, "tok_s": 31.6, "mem": 620.0},
}

MODELS = [
    {"name": "Llama-3.2-3B-Instruct-Q5_K_M.gguf", "size_bytes": 2_483_000_000, "family": "llama"},
    {"name": "Qwen2.5-0.5B-Instruct-Q5_K_M.gguf", "size_bytes": 420_000_000, "family": "qwen"},
]


SECTION = re.compile(r"^#{1,6}\s+(.*)$", re.M)


def split_sections(text: str) -> list[dict]:
    """Splits markdown into (heading, body) sections; unheaded text becomes one section."""
    headings = list(SECTION.finditer(text))
    if not headings:
        return [{"heading": None, "body": text.strip()}]

    sections = []
    for index, match in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        body = text[match.end() : end].strip()
        if body:
            sections.append({"heading": match.group(1).strip(), "body": body})
    return sections


STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from", "how", "in", "is",
    "it", "of", "on", "or", "que", "the", "to", "what", "when", "where", "which", "who",
    "why", "with", "does", "did", "can", "should", "must", "any", "there", "this", "that",
}


def words(text: str) -> set:
    return {w for w in re.findall(r"[a-z]{3,}", text.lower()) if w not in STOPWORDS}


def run_ingestion(job_id: int, title: str, filename: str, text: str = "") -> None:
    """Mirrors the real pipeline's shape: chunk count discovered, then offset advances."""
    job = state.jobs[job_id]
    time.sleep(0.4)
    with state.lock:
        job["total_chunks"] = CHUNKS_PER_DOCUMENT

    for offset in range(1, CHUNKS_PER_DOCUMENT + 1):
        time.sleep(SECONDS_PER_CHUNK)
        with state.lock:
            job["offset"] = offset
            job["last_checkpoint"] = {"offset": offset}

    with state.lock:
        job["status"] = "complete"
        document_id = state.id_for("document")
        state.documents.append(
            {
                "id": document_id,
                "title": title,
                "path": f"/Users/engineer/Documents/{filename}",
                "checksum": f"{job_id:064x}",
                "version": 1,
                "uploaded_at": now(),
                "indexed_at": now(),
            }
        )
        state.sections[document_id] = split_sections(text)


def run_benchmark(job_id: int) -> None:
    """
    Walks each model x device combination, the way src/benchmark.py does: load the model,
    generate a fixed prompt, record load time, time to first token and tokens per second.

    Deliberately slow. A real run loads several gigabytes per combination, and a benchmark
    that finished instantly would never exercise the polling, the progress line, or the
    warning that answering is unavailable while it runs.
    """
    job = state.benchmark_jobs[job_id]
    for model in job["models"]:
        for device in job["devices"]:
            with state.lock:
                job["current_model"] = model
                job["current_device"] = device

            time.sleep(2.0)
            profile = BENCHMARK_PROFILE.get(model, {"load_s": 2.0, "ttft_s": 1.0, "tok_s": 12.0, "mem": 1500.0})

            if device == "gpu" and not GPU_AVAILABLE:
                row = {
                    "model": model,
                    "device": device,
                    "device_name": None,
                    "status": "skipped",
                    "detail": (
                        "This build of llama-cpp-python has no CUDA/GPU offload support "
                        "installed."
                    ),
                    "load_s": None,
                    "ttft_s": None,
                    "gen_tokens": None,
                    "tok_s": None,
                    "total_s": None,
                    "peak_mem_mb": None,
                    "peak_vram_mb": None,
                    "run_at": now(),
                }
            else:
                gen_tokens = 128
                row = {
                    "model": model,
                    "device": device,
                    "device_name": platform.processor() or platform.machine(),
                    "status": "ok",
                    "detail": None,
                    "load_s": profile["load_s"],
                    "ttft_s": profile["ttft_s"],
                    "gen_tokens": gen_tokens,
                    "tok_s": profile["tok_s"],
                    "total_s": profile["load_s"] + profile["ttft_s"] + gen_tokens / profile["tok_s"],
                    "peak_mem_mb": profile["mem"],
                    "peak_vram_mb": None,
                    "run_at": now(),
                }

            with state.lock:
                job["results"].append(row)
                job["completed_runs"] += 1

    with state.lock:
        job["status"] = "completed"
        job["current_model"] = None
        job["current_device"] = None
        job["finished_at"] = now()


def answer_for(question: str) -> dict:
    """
    Extractive retrieval over the ingested text.

    This is NOT what the real service does — there is no embedding model and no LLM here,
    just word overlap and a slice of the best-matching section. The point is that a
    question about the corpus produces an answer *from* the corpus, with citations that
    name the section it came from, so the interface can be exercised against something
    truthful. Judge answer quality on the real service, never on this.
    """
    asked = words(question)
    if not asked or "xyzzy" in question.lower():
        return REFUSAL

    scored = []
    for document in state.documents:
        for position, section in enumerate(state.sections.get(document["id"], []), start=1):
            overlap = asked & words(f"{section['heading'] or ''} {section['body']}")
            if not overlap:
                continue
            # Heading matches count double: a question usually names the topic, not prose.
            heading_hits = asked & words(section["heading"] or "")
            score = (len(overlap) + len(heading_hits)) / len(asked)
            scored.append((min(score, 0.99), document, section, position))

    scored.sort(key=lambda row: row[0], reverse=True)
    if not scored or scored[0][0] < MIN_SIMILARITY:
        return REFUSAL

    best = scored[0]
    sentences = re.split(r"(?<=[.!?])\s+", best[2]["body"])
    return {
        "answer": " ".join(sentences[:3]).strip(),
        "citations": [
            {
                "title": document["title"],
                "section": section["heading"],
                # The stub has no paginator; section order stands in for a page number.
                "page": position,
                "score": round(score, 2),
            }
            for score, document, section, position in scored[:3]
        ],
        "not_found": False,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LocalChatStub/1"

    # -- plumbing ----------------------------------------------------------

    def log_message(self, fmt: str, *args) -> None:
        print(f"  {self.command:6} {self.path}", flush=True)

    def _cors(self) -> None:
        # The real service has no CORS middleware yet; the stub allows the dev server so
        # the client can be tested with or without Vite's proxy in front of it.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, status: int, payload: object | None) -> None:
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        if body:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _error(self, status: int, code: str, message: str, details: dict | None = None) -> None:
        self._send(status, {"code": code, "message": message, "details": details or {}})

    def _json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}

    def _multipart(self) -> dict:
        """
        Splits a multipart body into `title`, the upload's filename, and its text.

        `cgi` is gone in 3.13 and there is no stdlib replacement, so this splits on the
        boundary by hand. It only has to understand what this one client sends.

        The file's text is kept so answers can actually come out of the document. Binary
        formats decode to noise here — the stub has no PDF parser — so retrieval in the
        stub is only meaningful for .md and .txt.
        """
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        text = raw.decode("utf-8", errors="replace")

        match = re.search(r"boundary=(.+)$", self.headers.get("Content-Type", ""))
        if not match:
            return {"title": "", "filename": "", "text": ""}

        fields = {"title": "", "filename": "", "text": ""}
        for part in text.split("--" + match.group(1).strip('"')):
            if "\r\n\r\n" not in part:
                continue
            headers, _, body = part.partition("\r\n\r\n")
            body = body.rstrip("\r\n-")
            if 'name="title"' in headers:
                fields["title"] = body.strip()
            elif "filename=" in headers:
                name = re.search(r'filename="([^"]*)"', headers)
                fields["filename"] = name.group(1) if name else ""
                fields["text"] = body
        return fields

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, None)

    # -- routing -----------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/health":
            return self._send(200, {"status": "ok"})

        if path == "/docs":
            return self._send(200, state.documents)

        if match := re.fullmatch(r"/status/(\d+)", path):
            job = state.jobs.get(int(match.group(1)))
            if not job:
                return self._error(404, "ERR_NOT_FOUND", "Ingestion job not found")
            return self._send(
                200,
                {
                    "status": job["status"],
                    "offset": job["offset"],
                    "total_chunks": job["total_chunks"],
                    "last_checkpoint": job["last_checkpoint"],
                },
            )

        if path == "/conversations":
            ordered = sorted(state.conversations, key=lambda c: c["updated_at"], reverse=True)
            return self._send(200, ordered)

        if match := re.fullmatch(r"/conversations/(\d+)", path):
            conversation = self._conversation(int(match.group(1)))
            if conversation is None:
                return self._error(404, "ERR_NOT_FOUND", "Conversation not found")
            messages = [m for m in state.messages if m["conversation_id"] == conversation["id"]]
            return self._send(200, {**conversation, "messages": messages})

        if path == "/models":
            return self._send(200, MODELS)

        if path == "/models/active":
            return self._send(200, {**state.active, "gpu_available": GPU_AVAILABLE})

        if path == "/benchmark/results":
            return self._send(
                200,
                [
                    {
                        "benchmark_job_id": job["id"],
                        "status": job["status"],
                        "devices": job["devices"],
                        "models": job["models"],
                        "created_at": job["created_at"],
                        "finished_at": job["finished_at"],
                    }
                    for job in state.benchmark_jobs.values()
                ],
            )

        if match := re.fullmatch(r"/benchmark/results/(\d+)", path):
            job = state.benchmark_jobs.get(int(match.group(1)))
            if not job:
                return self._error(404, "ERR_NOT_FOUND", "Benchmark job not found")
            return self._send(
                200,
                {
                    "benchmark_job_id": job["id"],
                    "status": job["status"],
                    "results": job["results"],
                },
            )

        if match := re.fullmatch(r"/benchmark/status/(\d+)", path):
            job = state.benchmark_jobs.get(int(match.group(1)))
            if not job:
                return self._error(404, "ERR_NOT_FOUND", "Benchmark job not found")
            current = (
                f"{job['current_model']} on {job['current_device']}"
                if job["current_model"]
                else None
            )
            progress = (
                f"{job['completed_runs']} of {job['total_runs']}"
                if job["total_runs"]
                else "starting"
            )
            return self._send(200, {"status": job["status"], "progress": progress, "current": current})

        return self._error(404, "ERR_NOT_FOUND", f"No route for GET {path}")

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/ingest":
            fields = self._multipart()
            if not fields["filename"]:
                return self._error(400, "ERR_MISSING_FILE", "An upload file is required")
            job_id = state.id_for("job")
            state.jobs[job_id] = {
                "status": "running",
                "offset": 0,
                "total_chunks": 0,
                "last_checkpoint": None,
            }
            threading.Thread(
                target=run_ingestion,
                args=(
                    job_id,
                    fields["title"] or fields["filename"],
                    fields["filename"],
                    fields["text"],
                ),
                daemon=True,
            ).start()
            return self._send(202, {"job_id": job_id})

        if path == "/conversations":
            body = self._json_body()
            conversation = {
                "id": state.id_for("conversation"),
                "title": (body.get("title") or None),
                "created_at": now(),
                "updated_at": now(),
            }
            state.conversations.append(conversation)
            return self._send(201, conversation)

        if match := re.fullmatch(r"/conversations/(\d+)/messages", path):
            conversation = self._conversation(int(match.group(1)))
            if conversation is None:
                return self._error(404, "ERR_NOT_FOUND", "Conversation not found")
            question = (self._json_body().get("q") or "").strip()
            if not question:
                return self._error(
                    400, "ERR_VALIDATION", "Request validation failed", {"q": "is required"}
                )

            state.messages.append(
                {
                    "id": state.id_for("message"),
                    "conversation_id": conversation["id"],
                    "role": "user",
                    "text": question,
                    "citations": None,
                    "not_found": None,
                    "created_at": now(),
                }
            )
            # The real service generates before responding; the pause is the point.
            time.sleep(1.2)
            result = answer_for(question)
            assistant = {
                "id": state.id_for("message"),
                "conversation_id": conversation["id"],
                "role": "assistant",
                "text": result["answer"] or result.get("suggestion") or "",
                "citations": result["citations"],
                "not_found": result["not_found"],
                "created_at": now(),
            }
            state.messages.append(assistant)
            if not conversation["title"]:
                conversation["title"] = question[:59] + "…" if len(question) > 60 else question
            conversation["updated_at"] = assistant["created_at"]
            return self._send(201, assistant)

        if path == "/benchmark":
            body = self._json_body()
            devices = body.get("devices") or []
            if not devices:
                return self._error(
                    400, "ERR_VALIDATION", "Request validation failed", {"devices": "is required"}
                )
            unknown = [d for d in devices if d not in ("cpu", "gpu")]
            if unknown:
                return self._error(
                    400, "ERR_VALIDATION", "Request validation failed",
                    {"devices": f"must only contain ['cpu', 'gpu'], got {unknown}"},
                )
            if "gpu" in devices and not GPU_AVAILABLE:
                return self._error(
                    422,
                    "ERR_GPU_UNAVAILABLE",
                    'devices includes "gpu" but this build of llama-cpp-python has no '
                    "CUDA/GPU offload support installed. Install the CUDA-enabled wheel, "
                    "or benchmark cpu only.",
                    {"devices": devices},
                )

            models = body.get("models") or [entry["name"] for entry in MODELS]
            job_id = state.id_for("benchmark")
            state.benchmark_jobs[job_id] = {
                "id": job_id,
                "status": "running",
                "devices": devices,
                "models": models,
                "results": [],
                "completed_runs": 0,
                "total_runs": len(models) * len(devices),
                "current_model": None,
                "current_device": None,
                "created_at": now(),
                "finished_at": None,
            }
            threading.Thread(target=run_benchmark, args=(job_id,), daemon=True).start()
            return self._send(202, {"benchmark_job_id": job_id})

        if path == "/models/active":
            body = self._json_body()
            model = body.get("model")
            if model not in [entry["name"] for entry in MODELS]:
                return self._error(404, "ERR_NOT_FOUND", f"Unknown model '{model}'")
            if body.get("device") == "gpu":
                return self._error(
                    422,
                    "ERR_GPU_UNAVAILABLE",
                    'device="gpu" was requested but this build of llama-cpp-python has no '
                    "CUDA/GPU offload support installed.",
                    {"device": "gpu"},
                )
            time.sleep(1.5)  # a real swap unloads and reloads gigabytes
            state.active = {"model": model, "device": body.get("device", "cpu")}
            return self._send(200, {**state.active, "gpu_available": False})

        return self._error(404, "ERR_NOT_FOUND", f"No route for POST {path}")

    def do_PATCH(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if match := re.fullmatch(r"/conversations/(\d+)", path):
            conversation = self._conversation(int(match.group(1)))
            if conversation is None:
                return self._error(404, "ERR_NOT_FOUND", "Conversation not found")
            title = (self._json_body().get("title") or "").strip()
            if not title:
                return self._error(
                    400, "ERR_VALIDATION", "Request validation failed", {"title": "must not be empty"}
                )
            conversation["title"] = title
            return self._send(200, conversation)
        return self._error(404, "ERR_NOT_FOUND", f"No route for PATCH {path}")

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if match := re.fullmatch(r"/docs/(\d+)", path):
            target = int(match.group(1))
            before = len(state.documents)
            state.documents[:] = [d for d in state.documents if d["id"] != target]
            if len(state.documents) == before:
                return self._error(404, "ERR_NOT_FOUND", "Document not found")
            return self._send(204, None)

        if match := re.fullmatch(r"/conversations/(\d+)", path):
            target = int(match.group(1))
            if self._conversation(target) is None:
                return self._error(404, "ERR_NOT_FOUND", "Conversation not found")
            state.conversations[:] = [c for c in state.conversations if c["id"] != target]
            state.messages[:] = [m for m in state.messages if m["conversation_id"] != target]
            return self._send(204, None)

        return self._error(404, "ERR_NOT_FOUND", f"No route for DELETE {path}")

    def _conversation(self, conversation_id: int) -> dict | None:
        return next((c for c in state.conversations if c["id"] == conversation_id), None)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    arguments = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Handler)
    print(f"contract stub on http://127.0.0.1:{arguments.port}  (Ctrl-C to stop)")
    print("  not the real service - see the docstring in this file\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()

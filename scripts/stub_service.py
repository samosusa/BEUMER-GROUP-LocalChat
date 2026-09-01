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
        self.active = {"model": None, "device": None}
        self._next = {"document": 1, "conversation": 1, "message": 1, "job": 1}

    def id_for(self, kind: str) -> int:
        value = self._next[kind]
        self._next[kind] = value + 1
        return value


state = State()

MODELS = [
    {"name": "Llama-3.2-3B-Instruct-Q5_K_M.gguf", "size_bytes": 2_483_000_000, "family": "llama"},
    {"name": "Qwen2.5-0.5B-Instruct-Q5_K_M.gguf", "size_bytes": 420_000_000, "family": "qwen"},
]


def run_ingestion(job_id: int, title: str, filename: str) -> None:
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
        state.documents.append(
            {
                "id": state.id_for("document"),
                "title": title,
                "path": f"/Users/engineer/Documents/{filename}",
                "checksum": f"{job_id:064x}",
                "version": 1,
                "uploaded_at": now(),
                "indexed_at": now(),
            }
        )


def answer_for(question: str) -> dict:
    """
    Refuses anything with no document ingested, and anything containing "xyzzy", so both
    branches of the no-evidence panel can be seen on demand.
    """
    if not state.documents or "xyzzy" in question.lower():
        return {
            "answer": None,
            "citations": [],
            "not_found": True,
            "suggestion": "Try a more specific question about the ingested project documentation.",
        }

    citations = [
        {
            "title": document["title"],
            "section": section,
            "page": page,
            "score": score,
        }
        for document, section, page, score in zip(
            state.documents[:3],
            ["4.2 Belt drive", "7.1 Emergency stop", "Appendix B"],
            [41, 88, 133],
            [0.82, 0.61, 0.44],
        )
    ]
    body = (
        "The belt runs at 2.2 m/s with 600 mm spacing, giving 13,200 items per hour [1]. "
        "Emergency stop checks are logged weekly [2]."
    )
    return {"answer": body, "citations": citations, "not_found": False}


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

    def _multipart_fields(self) -> dict:
        """
        Pulls `title` and the upload's filename out of a multipart body.

        Deliberately crude: the stub never reads the file's contents, so there is no need
        for a real parser (and `cgi` is gone in 3.13). It only has to agree with the
        client about what it sent.
        """
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        text = raw.decode("utf-8", errors="replace")
        title = re.search(r'name="title"\r?\n\r?\n(.*?)\r?\n--', text, re.S)
        filename = re.search(r'filename="([^"]*)"', text)
        return {
            "title": title.group(1).strip() if title else "",
            "filename": filename.group(1) if filename else "",
        }

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
            return self._send(200, {**state.active, "gpu_available": False})

        return self._error(404, "ERR_NOT_FOUND", f"No route for GET {path}")

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/ingest":
            fields = self._multipart_fields()
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
                args=(job_id, fields["title"] or fields["filename"], fields["filename"]),
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

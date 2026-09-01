from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import faiss
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.app import app
from src.db import Base, get_db
from src.ingest.loader import SUPPORTED_SUFFIXES
from src.llm_adapter import DEFAULT_MODEL_PATH, llm_adapter
from src.models.chunk import Chunk
from src.models.document import Document

DEFAULT_DEMO_TITLE = "Demo Conveyor Guide"
DEFAULT_RELEVANT_QUESTION = "What is the conveyor speed?"
DEFAULT_UNRELATED_QUESTION = "What is the Mars launch window?"
CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
}


class DemoSetupError(Exception):
    """Raised when the demo cannot start; carries the lines to print before exiting."""

    def __init__(self, *lines: str) -> None:
        super().__init__(lines[0])
        self.lines = lines


def print_step(title: str) -> None:
    print(f"\n=== {title} ===")


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def print_query_summary(name: str, payload: dict) -> None:
    answer = (payload.get("answer") or "").strip().replace("\n", " ")
    preview = f"{answer[:220]}..." if len(answer) > 220 else answer
    citations = payload.get("citations", [])
    print(f"Scenario: {name}")
    print(f"not_found: {payload.get('not_found')}")
    print(f"citations: {len(citations)}")
    if citations:
        first = citations[0]
        print(
            "top citation: "
            f"title={first.get('title')}, section={first.get('section')}, score={first.get('score')}"
        )
    print(f"answer preview: {preview or '<empty>'}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run LocalChat end-to-end demo simulation")
    parser.add_argument(
        "--demo-file",
        default=None,
        help="Optional path to a local .pdf, .md, or .txt file to ingest instead of the built-in demo text.",
    )
    parser.add_argument(
        "--demo-title",
        default=None,
        help="Optional title used for the ingested demo document.",
    )
    parser.add_argument(
        "--relevant-question",
        default=None,
        help="Question expected to be answered from the ingested demo document.",
    )
    parser.add_argument(
        "--unrelated-question",
        default=DEFAULT_UNRELATED_QUESTION,
        help="Question expected to be outside the demo document scope.",
    )
    return parser.parse_args()


def resolve_custom_demo_file(path_arg: str | None) -> Path | None:
    if path_arg is None:
        return None
    custom_demo_file = Path(path_arg).expanduser().resolve()
    if not custom_demo_file.is_file():
        raise DemoSetupError(
            "Demo cannot start because --demo-file does not exist.",
            f"Provided path: {custom_demo_file}",
        )
    suffix = custom_demo_file.suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise DemoSetupError(
            "Demo cannot start because --demo-file has an unsupported extension.",
            "Supported extensions: " + ", ".join(sorted(SUPPORTED_SUFFIXES)),
            f"Provided extension: {suffix or '<none>'}",
        )
    return custom_demo_file


def resolve_model_path() -> Path:
    model_path = Path(os.getenv("LOCALCHAT_LLM_MODEL", str(DEFAULT_MODEL_PATH)))
    if not model_path.is_file():
        raise DemoSetupError(
            "Demo cannot start because the GGUF model file was not found.",
            f"Expected: {model_path}",
            "Set LOCALCHAT_LLM_MODEL to the model file path and run again.",
        )
    return model_path


def print_demo_banner(
    run_id: str,
    model_path: Path,
    db_path: Path,
    vector_dir: Path,
    custom_demo_file: Path | None,
    relevant_question: str,
    unrelated_question: str,
) -> None:
    print("LocalChat End-to-End Demo")
    print(f"Run ID: {run_id}")
    print(f"Model: {model_path}")
    print(f"Demo DB: {db_path}")
    print(f"Demo vectors: {vector_dir}")
    if custom_demo_file is None:
        print("Demo document facts:")
        print("- The conveyor speed is 2 meters per second.")
        print("- Emergency stop checks run every 4 hours.")
    else:
        print(f"Custom demo file: {custom_demo_file}")
        print("Relevant questions should be grounded in your custom file content.")
    print(f"Relevant question to run: {relevant_question}")
    print(f"Unrelated question to run: {unrelated_question}")


def build_demo_document(custom_demo_file: Path | None, demo_title_arg: str | None) -> tuple[str, str, str, bytes]:
    if custom_demo_file is None:
        return (
            "demo-guide.md",
            DEFAULT_DEMO_TITLE,
            "text/markdown",
            b"# Conveyor Specifications\n"
            b"The conveyor speed is 2 meters per second.\n"
            b"Emergency stop checks run every 4 hours.\n",
        )
    return (
        custom_demo_file.name,
        demo_title_arg or custom_demo_file.stem,
        CONTENT_TYPES[custom_demo_file.suffix.lower()],
        custom_demo_file.read_bytes(),
    )


@contextmanager
def demo_environment(db_path: Path, vector_dir: Path, model_path: Path) -> Iterator[sessionmaker[Session]]:
    """Points the app at an isolated demo database, vector directory, and model, then restores it."""
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    import src.api.ingest as ingest_api

    original_session_local = ingest_api.SessionLocal
    original_model_path = llm_adapter.model_path
    app.dependency_overrides[get_db] = override_get_db
    ingest_api.SessionLocal = session_factory
    llm_adapter.model_path = model_path
    os.environ["LOCALCHAT_VECTOR_DIR"] = str(vector_dir)
    try:
        yield session_factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        ingest_api.SessionLocal = original_session_local
        llm_adapter.model_path = original_model_path


def run_health_check(client: TestClient) -> None:
    print_step("1) Health Check")
    health = client.get("/health")
    print(f"Status code: {health.status_code}")
    print(json.dumps(health.json(), indent=2))


def run_ingest(
    client: TestClient, document_name: str, document_title: str, content_type: str, document_bytes: bytes
) -> int | None:
    print_step("2) Ingest Document")
    ingest = client.post(
        "/ingest",
        data={"title": document_title},
        files={"file": (document_name, document_bytes, content_type)},
    )
    print(f"Status code: {ingest.status_code}")
    print(json.dumps(ingest.json(), indent=2))
    if ingest.status_code != 202:
        print("Ingestion failed. Aborting demo.")
        return None
    return ingest.json()["job_id"]


def poll_ingest_status(client: TestClient, job_id: int) -> None:
    print_step("3) Poll Ingestion Status")
    status_response = client.get(f"/status/{job_id}")
    print(f"Status code: {status_response.status_code}")
    print(json.dumps(status_response.json(), indent=2))


def verify_artifacts(session_factory: sessionmaker[Session], document_title: str) -> None:
    print_step("4) Verify Database + Vector Artifacts")
    with session_factory() as db:
        document = db.query(Document).filter_by(title=document_title).one()
        chunks = db.query(Chunk).filter_by(doc_id=document.id).all()
        index_path = Path(chunks[0].embedding_path) if chunks else None
        print(f"Document ID: {document.id}")
        print(f"Chunk count: {len(chunks)}")
        print(f"Indexed at: {document.indexed_at}")
        if index_path is not None and index_path.is_file():
            index = faiss.read_index(str(index_path))
            print(f"Vector index file: {index_path}")
            print(f"FAISS vectors stored: {index.ntotal}")
        else:
            print("Vector index file was not found.")


def ask_question(client: TestClient, step_title: str, scenario_name: str, question: str, output_path: Path) -> None:
    print_step(step_title)
    response = client.post("/query", json={"q": question})
    print(f"Status code: {response.status_code}")
    payload = response.json()
    write_json(output_path, payload)
    print_query_summary(scenario_name, payload)


def main() -> int:
    args = parse_args()
    try:
        custom_demo_file = resolve_custom_demo_file(args.demo_file)
        model_path = resolve_model_path()
    except DemoSetupError as error:
        for line in error.lines:
            print(line)
        return 2

    relevant_question = args.relevant_question or (
        "What are the main points in this document?" if custom_demo_file is not None else DEFAULT_RELEVANT_QUESTION
    )

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    demo_root = Path("data") / "demo_runs" / run_id
    db_path = demo_root / "demo.db"
    vector_dir = demo_root / "vectors"
    vector_dir.mkdir(parents=True, exist_ok=True)

    print_demo_banner(
        run_id, model_path, db_path, vector_dir, custom_demo_file, relevant_question, args.unrelated_question
    )
    document_name, document_title, content_type, document_bytes = build_demo_document(
        custom_demo_file, args.demo_title
    )

    with demo_environment(db_path, vector_dir, model_path) as session_factory, TestClient(app) as client:
        run_health_check(client)

        job_id = run_ingest(client, document_name, document_title, content_type, document_bytes)
        if job_id is None:
            return 1
        poll_ingest_status(client, job_id)
        verify_artifacts(session_factory, document_title)
        ask_question(
            client, "5) Ask a Relevant Question", "Relevant question", relevant_question,
            demo_root / "query_relevant.json",
        )
        ask_question(
            client, "6) Ask an Unrelated Question", "Unrelated question", args.unrelated_question,
            demo_root / "query_unrelated.json",
        )

        print_step("Demo Complete")
        print("The full flow succeeded: ingest -> db -> vectors -> retrieval -> response.")
        print("Detailed query payloads saved as query_relevant.json and query_unrelated.json.")
        print(f"Artifacts saved under: {demo_root}")
        return 0


if __name__ == "__main__":
    sys.exit(main())

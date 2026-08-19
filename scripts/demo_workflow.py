from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import faiss
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.app import app
from src.db import Base, get_db
from src.llm_adapter import DEFAULT_MODEL_PATH, llm_adapter
from src.models.chunk import Chunk
from src.models.document import Document

DEFAULT_DEMO_TITLE = "Demo Conveyor Guide"
DEFAULT_RELEVANT_QUESTION = "What is the conveyor speed?"
DEFAULT_UNRELATED_QUESTION = "What is the Mars launch window?"
SUPPORTED_SUFFIXES = {".pdf", ".md", ".txt"}
CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".md": "text/markdown",
    ".txt": "text/plain",
}


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


def main() -> int:
    args = parse_args()
    custom_demo_file = Path(args.demo_file).expanduser().resolve() if args.demo_file else None
    if custom_demo_file is not None:
        if not custom_demo_file.is_file():
            print("Demo cannot start because --demo-file does not exist.")
            print(f"Provided path: {custom_demo_file}")
            return 2
        suffix = custom_demo_file.suffix.lower()
        if suffix not in SUPPORTED_SUFFIXES:
            print("Demo cannot start because --demo-file has an unsupported extension.")
            print("Supported extensions: .pdf, .md, .txt")
            print(f"Provided extension: {suffix or '<none>'}")
            return 2

    relevant_question = args.relevant_question
    if relevant_question is None:
        relevant_question = (
            "What are the main points in this document?"
            if custom_demo_file is not None
            else DEFAULT_RELEVANT_QUESTION
        )

    model_path = Path(os.getenv("LOCALCHAT_LLM_MODEL", str(DEFAULT_MODEL_PATH)))
    if not model_path.is_file():
        print("Demo cannot start because the GGUF model file was not found.")
        print(f"Expected: {model_path}")
        print("Set LOCALCHAT_LLM_MODEL to the model file path and run again.")
        return 2

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    demo_root = Path("data") / "demo_runs" / run_id
    db_path = demo_root / "demo.db"
    vector_dir = demo_root / "vectors"
    vector_dir.mkdir(parents=True, exist_ok=True)

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
    print(f"Unrelated question to run: {args.unrelated_question}")

    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
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
        with TestClient(app) as client:
            print_step("1) Health Check")
            health = client.get("/health")
            print(f"Status code: {health.status_code}")
            print(json.dumps(health.json(), indent=2))

            print_step("2) Ingest Document")
            if custom_demo_file is None:
                document_name = "demo-guide.md"
                document_title = DEFAULT_DEMO_TITLE
                content_type = "text/markdown"
                document_bytes = (
                    b"# Conveyor Specifications\n"
                    b"The conveyor speed is 2 meters per second.\n"
                    b"Emergency stop checks run every 4 hours.\n"
                )
            else:
                document_name = custom_demo_file.name
                document_title = args.demo_title or custom_demo_file.stem
                content_type = CONTENT_TYPES[custom_demo_file.suffix.lower()]
                document_bytes = custom_demo_file.read_bytes()

            ingest = client.post(
                "/ingest",
                data={"title": document_title},
                files={"file": (document_name, document_bytes, content_type)},
            )
            print(f"Status code: {ingest.status_code}")
            print(json.dumps(ingest.json(), indent=2))
            if ingest.status_code != 202:
                print("Ingestion failed. Aborting demo.")
                return 1

            job_id = ingest.json()["job_id"]

            print_step("3) Poll Ingestion Status")
            status_response = client.get(f"/status/{job_id}")
            print(f"Status code: {status_response.status_code}")
            print(json.dumps(status_response.json(), indent=2))

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

            print_step("5) Ask a Relevant Question")
            relevant_query = {"q": relevant_question}
            relevant = client.post("/query", json=relevant_query)
            print(f"Status code: {relevant.status_code}")
            relevant_payload = relevant.json()
            write_json(demo_root / "query_relevant.json", relevant_payload)
            print_query_summary("Relevant question", relevant_payload)

            print_step("6) Ask an Unrelated Question")
            unrelated_query = {"q": args.unrelated_question}
            unrelated = client.post("/query", json=unrelated_query)
            print(f"Status code: {unrelated.status_code}")
            unrelated_payload = unrelated.json()
            write_json(demo_root / "query_unrelated.json", unrelated_payload)
            print_query_summary("Unrelated question", unrelated_payload)

            print_step("Demo Complete")
            print("The full flow succeeded: ingest -> db -> vectors -> retrieval -> response.")
            print("Detailed query payloads saved as query_relevant.json and query_unrelated.json.")
            print(f"Artifacts saved under: {demo_root}")
            return 0
    finally:
        app.dependency_overrides.pop(get_db, None)
        ingest_api.SessionLocal = original_session_local
        llm_adapter.model_path = original_model_path


if __name__ == "__main__":
    sys.exit(main())
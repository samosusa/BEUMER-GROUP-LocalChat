"""Opt-in test for the complete local workflow with real models and storage."""

import importlib.util
import os
import time
import warnings
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.app import app
from src.db import Base, get_db
from src.llm_adapter import llm_adapter
from src.models.chunk import Chunk
from src.models.document import Document

def test_real_ingest_retrieve_generate_workflow(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    if os.getenv("LOCALCHAT_RUN_REAL_E2E") != "1":
        pytest.skip("Set LOCALCHAT_RUN_REAL_E2E=1 to run the real model workflow")

    model_path = Path(os.getenv("LOCALCHAT_LLM_MODEL", "data/models/Llama-3.2-3B-Instruct-Q5_K_M.gguf"))
    if not model_path.is_file():
        pytest.skip(f"Llama-3.2-3B-Instruct GGUF model not found: {model_path}")
    if importlib.util.find_spec("llama_cpp") is None:
        pytest.skip("llama-cpp-python is not installed")

    database_path = tmp_path / "real-workflow.db"
    vector_path = tmp_path / "vectors"
    engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        with session_factory() as session:
            yield session

    import src.api.ingest as ingest_api

    monkeypatch.setenv("LOCALCHAT_VECTOR_DIR", str(vector_path))
    monkeypatch.setattr(ingest_api, "SessionLocal", session_factory)
    llm_adapter.model_path = model_path
    app.dependency_overrides[get_db] = override_get_db

    try:
        with TestClient(app) as client:
            upload = client.post(
                "/ingest",
                data={"title": "Real workflow guide"},
                files={
                    "file": (
                        "guide.md",
                        b"# Conveyor Specifications\nThe conveyor speed is 2 meters per second.",
                        "text/markdown",
                    )
                },
            )
            assert upload.status_code == 202, upload.text
            job_id = upload.json()["job_id"]

            status_response = client.get(f"/status/{job_id}")
            assert status_response.status_code == 200, status_response.text
            assert status_response.json()["status"] == "completed"

            with session_factory() as db:
                document = db.query(Document).filter_by(title="Real workflow guide").one()
                chunks = db.query(Chunk).filter_by(doc_id=document.id).all()
                assert chunks
                assert chunks[0].section == "Conveyor Specifications"
                assert Path(chunks[0].embedding_path).is_file()

            started = time.perf_counter()
            response = client.post("/query", json={"q": "What is the conveyor speed?"})
            latency = time.perf_counter() - started
            print(f"real workflow query latency: {latency:.2f}s")
            if latency > 20:
                warnings.warn("Real query exceeded the 20-second target", RuntimeWarning)

            assert response.status_code == 200, response.text
            result = response.json()
            assert result["not_found"] is False
            assert result["answer"]
            assert result["citations"]
            assert result["citations"][0]["title"] == "Real workflow guide"
            assert result["citations"][0]["section"] == "Conveyor Specifications"
    finally:
        app.dependency_overrides.pop(get_db, None)
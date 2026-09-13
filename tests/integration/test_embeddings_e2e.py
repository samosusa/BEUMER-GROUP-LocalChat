"""Exercised against the same shared, session-isolated test database as
test_benchmark_e2e.py/test_query_e2e.py (see tests/conftest.py) rather than a fully isolated
one: POST /embeddings/active launches its re-embed job as a BackgroundTasks task, which opens
its own SessionLocal() rather than using the request's injected db session (mirroring
src/api/ingest.py and src/api/benchmark.py) - a separately-created isolated engine would never
be visible to it. Real sentence-transformers weights are never downloaded here: _get_model is
faked file-wide so every embedding model behaves like a small local one.
"""

import pytest
from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.ingest.embedder import EmbeddingModel, embedding_adapter
from src.models.document import Document

client = TestClient(app)


class _FakeSentenceTransformer:
    def __init__(self, dimension: int) -> None:
        self.dimension = dimension

    def encode(self, texts, **kwargs):
        return [[1.0] * self.dimension for _ in texts]


@pytest.fixture(autouse=True)
def _fake_embedding_models(monkeypatch):
    monkeypatch.setattr(EmbeddingModel, "_get_model", lambda self: _FakeSentenceTransformer(self.spec.dimension))


@pytest.fixture(autouse=True)
def _restore_active_embedding_model():
    """set_active mutates the process-wide embedding_adapter singleton (mirrors llm_adapter);
    restore it afterwards so a switch in one test can't leak into a later, unrelated one."""
    original = embedding_adapter.active["model"]
    try:
        yield
    finally:
        embedding_adapter.set_active(original)


def test_list_embedding_models_returns_the_registered_models():
    response = client.get("/embeddings/models")

    assert response.status_code == 200
    names = {item["name"] for item in response.json()}
    assert {"nomic-ai/nomic-embed-text-v1.5", "BAAI/bge-small-en-v1.5"} <= names


def test_get_active_model_reports_a_valid_registered_model():
    response = client.get("/embeddings/active")

    assert response.status_code == 200
    body = response.json()
    assert body["model"]
    assert body["dimension"] > 0


def test_set_active_model_rejects_unknown_model():
    response = client.post("/embeddings/active", json={"model": "not-a-real-model"})

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_reindex_status_unknown_job_returns_not_found():
    response = client.get("/embeddings/reindex/status/999999999")

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_set_active_model_switches_and_reindexes_existing_documents(monkeypatch):
    import src.api.ingest as ingest_api
    from src.ingest.pipeline import run_pipeline

    def fake_process_upload(job_id: int, title: str, path: str, project_id: int | None = None) -> None:
        with SessionLocal() as db:
            run_pipeline(db, job_id, title, path, project_id=project_id)

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)

    title = "Reindex E2E Doc"
    ingest_response = client.post(
        "/ingest",
        data={"title": title},
        files={"file": ("guide.txt", b"The conveyor speed is 2 meters per second.", "text/plain")},
    )
    assert ingest_response.status_code == 202
    assert client.get(f"/status/{ingest_response.json()['job_id']}").json()["status"] == "completed"

    with SessionLocal() as db:
        document = db.query(Document).filter_by(title=title).first()
        assert document is not None
        original_model = document.embedding_model
        assert original_model is not None

    target_model = "intfloat/e5-base-v2" if original_model != "intfloat/e5-base-v2" else "BAAI/bge-small-en-v1.5"
    switch_response = client.post("/embeddings/active", json={"model": target_model})
    assert switch_response.status_code == 202
    body = switch_response.json()
    assert body["model"] == target_model
    reindex_job_id = body["reindex_job_id"]

    status_response = client.get(f"/embeddings/reindex/status/{reindex_job_id}")
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "completed"
    assert status_response.json()["model"] == target_model

    with SessionLocal() as db:
        document = db.query(Document).filter_by(title=title).first()
        assert document.embedding_model == target_model
        assert document.embedding_dim == body["dimension"]

    runs_response = client.get("/embeddings/reindex")
    assert runs_response.status_code == 200
    assert any(run["reindex_job_id"] == reindex_job_id for run in runs_response.json())


def test_embedding_benchmark_runs_and_stores_results():
    response = client.post("/embeddings/benchmark", json={"models": ["sentence-transformers/all-MiniLM-L6-v2"]})
    assert response.status_code == 202
    job_id = response.json()["embedding_benchmark_job_id"]

    status_response = client.get(f"/embeddings/benchmark/status/{job_id}")
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "completed"
    assert "of" in status_response.json()["progress"]

    results_response = client.get(f"/embeddings/benchmark/results/{job_id}")
    assert results_response.status_code == 200
    body = results_response.json()
    assert body["status"] == "completed"
    assert {row["text_label"] for row in body["results"]} == {"short", "medium", "long"}
    assert all(row["status"] == "ok" for row in body["results"])
    assert all(row["model"] == "sentence-transformers/all-MiniLM-L6-v2" for row in body["results"])

    runs_response = client.get("/embeddings/benchmark/results")
    assert runs_response.status_code == 200
    assert any(run["embedding_benchmark_job_id"] == job_id for run in runs_response.json())


def test_embedding_benchmark_rejects_unknown_model():
    response = client.post("/embeddings/benchmark", json={"models": ["not-a-real-model"]})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"


def test_embedding_benchmark_status_unknown_job_returns_not_found():
    response = client.get("/embeddings/benchmark/status/999999999")

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_embedding_benchmark_results_unknown_job_returns_not_found():
    response = client.get("/embeddings/benchmark/results/999999999")

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"

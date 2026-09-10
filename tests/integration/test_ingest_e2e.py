from pathlib import Path

import faiss
from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.models.chunk import Chunk
from src.models.document import Document


def test_upload_chunks_and_stores_vectors(tmp_path: Path, monkeypatch):
    import src.api.ingest as ingest_api

    def fake_process_upload(job_id: int, title: str, path: str, project_id: int | None = None) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(
                db, job_id, title, path, embedder=lambda texts: [[1.0, 0.0] for _ in texts], project_id=project_id
            )
        Path(path).unlink(missing_ok=True)

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)
    client = TestClient(app)
    response = client.post(
        "/ingest",
        data={"title": "Sample guide"},
        files={"file": ("guide.txt", b"The conveyor speed is 2 meters per second.", "text/plain")},
    )

    assert response.status_code == 202
    job_id = response.json()["job_id"]
    status_response = client.get(f"/status/{job_id}")
    assert status_response.json()["status"] == "completed"

    with SessionLocal() as db:
        document = db.query(Document).filter_by(title="Sample guide").order_by(Document.id.desc()).first()
        assert document is not None
        assert document.indexed_at is not None
        assert document.complexity_tier in ("simple", "moderate", "complex")
        assert document.complexity_score is not None
        chunks = db.query(Chunk).filter_by(doc_id=document.id).all()
        assert len(chunks) == 1
        assert chunks[0].embedding_path
        index_path = Path(chunks[0].embedding_path)
        assert index_path.exists()
        assert faiss.read_index(str(index_path)).ntotal == len(chunks)


def test_ingest_stamps_document_with_given_project(monkeypatch):
    import src.api.ingest as ingest_api

    def fake_process_upload(job_id: int, title: str, path: str, project_id: int | None = None) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(
                db, job_id, title, path, embedder=lambda texts: [[1.0, 0.0] for _ in texts], project_id=project_id
            )
        Path(path).unlink(missing_ok=True)

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)
    client = TestClient(app)

    project = client.post("/projects", json={"name": "Scoped project"}).json()
    response = client.post(
        "/ingest",
        data={"title": "Scoped guide", "project_id": project["id"]},
        files={"file": ("scoped.txt", b"Project-only content.", "text/plain")},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    assert client.get(f"/status/{job_id}").json()["status"] == "completed"

    with SessionLocal() as db:
        document = db.query(Document).filter_by(title="Scoped guide").order_by(Document.id.desc()).first()
        assert document is not None
        assert document.project_id == project["id"]


def test_ingest_rejects_unknown_project():
    client = TestClient(app)
    response = client.post(
        "/ingest",
        data={"title": "Orphan guide", "project_id": 999999},
        files={"file": ("orphan.txt", b"content", "text/plain")},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"
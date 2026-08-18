from pathlib import Path

import faiss
from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.models.chunk import Chunk
from src.models.document import Document


def test_upload_chunks_and_stores_vectors(tmp_path: Path, monkeypatch):
    import src.api.ingest as ingest_api

    def fake_process_upload(job_id: int, title: str, path: str) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(db, job_id, title, path, embedder=lambda texts: [[1.0, 0.0] for _ in texts])
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
        chunks = db.query(Chunk).filter_by(doc_id=document.id).all()
        assert len(chunks) == 1
        assert chunks[0].embedding_path
        index_path = Path(chunks[0].embedding_path)
        assert index_path.exists()
        assert faiss.read_index(str(index_path)).ntotal == len(chunks)
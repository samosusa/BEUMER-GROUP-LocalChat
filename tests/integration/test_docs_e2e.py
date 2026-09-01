from pathlib import Path

from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.models.chunk import Chunk
from src.models.document import Document


client = TestClient(app)


def test_create_read_delete_document(tmp_path: Path):
    document_path = tmp_path / "guide.txt"
    document_path.write_text("LocalChat documentation", encoding="utf-8")

    response = client.post("/docs", json={"title": "Guide", "path": str(document_path)})
    assert response.status_code == 201
    created = response.json()
    assert created["title"] == "Guide"
    assert created["path"] == str(document_path)
    assert len(created["checksum"]) == 64

    read_response = client.get(f"/docs/{created['id']}")
    assert read_response.status_code == 200
    assert read_response.json() == created

    delete_response = client.delete(f"/docs/{created['id']}")
    assert delete_response.status_code == 204
    assert client.get(f"/docs/{created['id']}").status_code == 404


def test_list_documents_includes_created_document(tmp_path: Path):
    document_path = tmp_path / "listed.txt"
    document_path.write_text("LocalChat documentation", encoding="utf-8")

    created = client.post("/docs", json={"title": "Listed Guide", "path": str(document_path)}).json()

    try:
        list_response = client.get("/docs")
        assert list_response.status_code == 200
        ids = [doc["id"] for doc in list_response.json()]
        assert created["id"] in ids
    finally:
        client.delete(f"/docs/{created['id']}")


def test_missing_document_returns_404():
    assert client.get("/docs/999999").status_code == 404


def test_create_missing_file_returns_400():
    response = client.post("/docs", json={"title": "Missing", "path": "does-not-exist.txt"})
    assert response.status_code == 400


def test_delete_document_cascades_chunks_and_vector_index(tmp_path: Path, monkeypatch):
    """A deleted document must take its chunks and FAISS index with it, or a future
    query can still retrieve and cite a document the user believes was removed."""
    import src.api.ingest as ingest_api

    def fake_process_upload(job_id: int, title: str, path: str) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(db, job_id, title, path, embedder=lambda texts: [[1.0, 0.0] for _ in texts])
        Path(path).unlink(missing_ok=True)

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)

    response = client.post(
        "/ingest",
        data={"title": "Cascade delete guide"},
        files={"file": ("cascade.txt", b"The conveyor speed is 2 meters per second.", "text/plain")},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    assert client.get(f"/status/{job_id}").json()["status"] == "completed"

    with SessionLocal() as db:
        document = db.query(Document).filter_by(title="Cascade delete guide").order_by(Document.id.desc()).first()
        document_id = document.id
        chunks_before = db.query(Chunk).filter_by(doc_id=document_id).all()
        assert len(chunks_before) == 1
        index_path = Path(chunks_before[0].embedding_path)
        assert index_path.is_file()

    delete_response = client.delete(f"/docs/{document_id}")
    assert delete_response.status_code == 204

    with SessionLocal() as db:
        assert db.get(Document, document_id) is None
        assert db.query(Chunk).filter_by(doc_id=document_id).count() == 0
    assert not index_path.exists()
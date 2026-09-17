from pathlib import Path

import faiss
from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.models.chunk import Chunk
from src.models.document import Document


def test_upload_chunks_and_stores_vectors(tmp_path: Path, monkeypatch):
    import src.api.ingest as ingest_api

    def fake_process_upload(
        job_id: int, title: str, path: str, project_id: int | None = None, also_general: bool = False
    ) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(
                db,
                job_id,
                title,
                path,
                embedder=lambda texts: [[1.0, 0.0] for _ in texts],
                project_id=project_id,
                also_general=also_general,
            )
        Path(path).unlink(missing_ok=True)

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)
    client = TestClient(app)
    response = client.post(
        "/ingest",
        data={"title": "Sample guide"},
        files={"file": ("guide.txt", b"The conveyor speed is 2 meters per second. (upload fixture)", "text/plain")},
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

    def fake_process_upload(
        job_id: int, title: str, path: str, project_id: int | None = None, also_general: bool = False
    ) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(
                db,
                job_id,
                title,
                path,
                embedder=lambda texts: [[1.0, 0.0] for _ in texts],
                project_id=project_id,
                also_general=also_general,
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


def test_ingest_with_also_general_flags_document_for_the_general_corpus(monkeypatch):
    import src.api.ingest as ingest_api

    def fake_process_upload(
        job_id: int, title: str, path: str, project_id: int | None = None, also_general: bool = False
    ) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(
                db,
                job_id,
                title,
                path,
                embedder=lambda texts: [[1.0, 0.0] for _ in texts],
                project_id=project_id,
                also_general=also_general,
            )
        Path(path).unlink(missing_ok=True)

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)
    client = TestClient(app)

    project = client.post("/projects", json={"name": "Shared with general"}).json()
    response = client.post(
        "/ingest",
        data={"title": "Shared guide", "project_id": project["id"], "also_general": "true"},
        files={"file": ("shared.txt", b"Content shared with the general corpus.", "text/plain")},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    assert client.get(f"/status/{job_id}").json()["status"] == "completed"

    with SessionLocal() as db:
        document = db.query(Document).filter_by(title="Shared guide").order_by(Document.id.desc()).first()
        assert document is not None
        assert document.project_id == project["id"]
        assert document.also_general is True


def test_duplicate_content_is_rejected_and_temp_dir_is_cleaned_up(monkeypatch):
    import src.api.ingest as ingest_api

    def fake_process_upload(
        job_id: int, title: str, path: str, project_id: int | None = None, also_general: bool = False
    ) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(
                db,
                job_id,
                title,
                path,
                embedder=lambda texts: [[1.0, 0.0] for _ in texts],
                project_id=project_id,
                also_general=also_general,
            )
        Path(path).unlink(missing_ok=True)

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)

    created_dirs: list[Path] = []
    real_mkdtemp = ingest_api.tempfile.mkdtemp

    def tracking_mkdtemp(*args, **kwargs):
        path = Path(real_mkdtemp(*args, **kwargs))
        created_dirs.append(path)
        return str(path)

    monkeypatch.setattr(ingest_api.tempfile, "mkdtemp", tracking_mkdtemp)

    client = TestClient(app)
    content = b"Identical content uploaded twice."
    # Scoped to its own project so this document never lands in the general corpus - other
    # tests' unscoped /query assertions retrieve from that shared corpus and don't expect an
    # extra competing document with a tied similarity score to show up there.
    project_id = client.post("/projects", json={"name": "Duplicate content test"}).json()["id"]

    first = client.post(
        "/ingest",
        data={"title": "First upload", "project_id": project_id},
        files={"file": ("first.txt", content, "text/plain")},
    )
    assert first.status_code == 202
    assert client.get(f"/status/{first.json()['job_id']}").json()["status"] == "completed"

    second = client.post(
        "/ingest",
        data={"title": "Second upload, same bytes", "project_id": project_id},
        files={"file": ("second.txt", content, "text/plain")},
    )
    assert second.status_code == 409
    assert second.json()["code"] == "ERR_DUPLICATE_DOCUMENT"

    # The second request's own temp dir (not the first's, which fake_process_upload already
    # cleaned up) must not be left behind after the duplicate is rejected.
    assert not created_dirs[-1].exists()


def test_ingest_rejects_unknown_project():
    client = TestClient(app)
    response = client.post(
        "/ingest",
        data={"title": "Orphan guide", "project_id": 999999},
        files={"file": ("orphan.txt", b"content", "text/plain")},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"
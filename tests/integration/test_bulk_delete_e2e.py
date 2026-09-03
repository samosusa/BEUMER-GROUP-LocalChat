"""Bulk "delete everything" endpoints, exercised against an isolated database and vector
directory rather than the shared dev one — a bug in a bulk delete is a bug that destroys
data, so these must never run against `data/app.db`."""

from datetime import datetime
from pathlib import Path

import faiss
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from src.app import app
from src.db import Base, get_db
from src.models.chunk import Chunk
from src.models.conversation import Conversation
from src.models.document import Document
from src.models.message import Message
from src.models.project import Project


@pytest.fixture
def isolated_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A TestClient bound to a throwaway SQLite file and vector directory for this test only."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False}
    )

    # SQLite only enforces (and cascades on) foreign keys when this pragma is set per
    # connection — src/db.py does the same for the app's own engine, but that listener is
    # attached to that specific engine object, not global, so a separately created test
    # engine needs its own or every cascade assertion here would silently no-op.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        with session_factory() as session:
            yield session

    monkeypatch.setenv("LOCALCHAT_VECTOR_DIR", str(tmp_path / "vectors"))
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client, session_factory
    finally:
        app.dependency_overrides.pop(get_db, None)


def _write_index(vector_dir: Path, document_id: int) -> Path:
    vector_dir.mkdir(parents=True, exist_ok=True)
    index = faiss.IndexFlatIP(2)
    index.add(np.asarray([[1.0, 0.0]], dtype="float32"))
    path = vector_dir / f"{document_id}.index"
    faiss.write_index(index, str(path))
    return path


def _add_document(session_factory, project_id: int | None, vector_dir: Path) -> int:
    with session_factory() as db:
        document = Document(
            title="doc",
            path="doc.txt",
            checksum=f"checksum-{project_id}-{vector_dir}-{datetime.utcnow().timestamp()}",
            version=1,
            project_id=project_id,
            uploaded_at=datetime.utcnow(),
        )
        db.add(document)
        db.commit()
        document_id = document.id
    _write_index(vector_dir, document_id)
    return document_id


def test_delete_all_documents_removes_every_document_and_its_vector_index(
    isolated_client, tmp_path
):
    client, session_factory = isolated_client
    vector_dir = tmp_path / "vectors"
    general_id = _add_document(session_factory, None, vector_dir)
    scoped_id = _add_document(session_factory, None, vector_dir)

    response = client.delete("/docs")
    assert response.status_code == 204

    with session_factory() as db:
        assert db.get(Document, general_id) is None
        assert db.get(Document, scoped_id) is None
    assert not (vector_dir / f"{general_id}.index").exists()
    assert not (vector_dir / f"{scoped_id}.index").exists()


def test_delete_all_documents_project_id_null_only_removes_general_corpus(
    isolated_client, tmp_path
):
    client, session_factory = isolated_client
    vector_dir = tmp_path / "vectors"
    project = client.post("/projects", json={"name": "Keep me"}).json()
    general_id = _add_document(session_factory, None, vector_dir)
    scoped_id = _add_document(session_factory, project["id"], vector_dir)

    response = client.delete("/docs", params={"project_id": "null"})
    assert response.status_code == 204

    with session_factory() as db:
        assert db.get(Document, general_id) is None
        assert db.get(Document, scoped_id) is not None
    assert not (vector_dir / f"{general_id}.index").exists()
    assert (vector_dir / f"{scoped_id}.index").exists()


def test_delete_all_documents_numeric_project_id_only_removes_that_projects_documents(
    isolated_client, tmp_path
):
    client, session_factory = isolated_client
    vector_dir = tmp_path / "vectors"
    project_a = client.post("/projects", json={"name": "A"}).json()
    project_b = client.post("/projects", json={"name": "B"}).json()
    doc_a = _add_document(session_factory, project_a["id"], vector_dir)
    doc_b = _add_document(session_factory, project_b["id"], vector_dir)

    response = client.delete("/docs", params={"project_id": str(project_a["id"])})
    assert response.status_code == 204

    with session_factory() as db:
        assert db.get(Document, doc_a) is None
        assert db.get(Document, doc_b) is not None


def test_delete_all_documents_rejects_a_non_numeric_project_id(isolated_client):
    client, _ = isolated_client
    response = client.delete("/docs", params={"project_id": "not-a-number"})
    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"


def test_delete_project_single_also_cleans_up_its_documents_vector_index(
    isolated_client, tmp_path
):
    """Regression test: the DB's ON DELETE CASCADE only removes rows, never the FAISS index
    file living outside the database — deleting a project used to leave those orphaned."""
    client, session_factory = isolated_client
    vector_dir = tmp_path / "vectors"
    project = client.post("/projects", json={"name": "Solo"}).json()
    document_id = _add_document(session_factory, project["id"], vector_dir)

    response = client.delete(f"/projects/{project['id']}")
    assert response.status_code == 204

    with session_factory() as db:
        assert db.get(Document, document_id) is None
    assert not (vector_dir / f"{document_id}.index").exists()


def test_delete_all_projects_cascades_documents_conversations_and_vector_indexes(
    isolated_client, tmp_path
):
    client, session_factory = isolated_client
    vector_dir = tmp_path / "vectors"
    project_a = client.post("/projects", json={"name": "A"}).json()
    project_b = client.post("/projects", json={"name": "B"}).json()
    doc_a = _add_document(session_factory, project_a["id"], vector_dir)
    doc_b = _add_document(session_factory, project_b["id"], vector_dir)
    general_doc = _add_document(session_factory, None, vector_dir)

    conversation_a = client.post("/conversations", json={"project_id": project_a["id"]}).json()
    with session_factory() as db:
        db.add(
            Message(
                conversation_id=conversation_a["id"],
                role="user",
                text="hi",
                created_at=datetime.utcnow(),
            )
        )
        db.commit()
    general_conversation = client.post("/conversations", json={}).json()

    response = client.delete("/projects")
    assert response.status_code == 204

    with session_factory() as db:
        assert db.query(Project).count() == 0
        assert db.get(Document, doc_a) is None
        assert db.get(Document, doc_b) is None
        assert db.get(Conversation, conversation_a["id"]) is None
        assert db.query(Message).filter_by(conversation_id=conversation_a["id"]).count() == 0
        # Nothing project-less is touched.
        assert db.get(Document, general_doc) is not None
        assert db.get(Conversation, general_conversation["id"]) is not None

    assert not (vector_dir / f"{doc_a}.index").exists()
    assert not (vector_dir / f"{doc_b}.index").exists()
    assert (vector_dir / f"{general_doc}.index").exists()


def test_delete_all_conversations_removes_every_conversation_and_its_messages(isolated_client):
    client, session_factory = isolated_client
    first = client.post("/conversations", json={}).json()
    second = client.post("/conversations", json={}).json()
    with session_factory() as db:
        db.add_all(
            [
                Message(conversation_id=first["id"], role="user", text="hi", created_at=datetime.utcnow()),
                Message(
                    conversation_id=second["id"], role="user", text="hi", created_at=datetime.utcnow()
                ),
            ]
        )
        db.commit()

    response = client.delete("/conversations")
    assert response.status_code == 204

    with session_factory() as db:
        assert db.query(Conversation).count() == 0
        assert db.query(Message).count() == 0

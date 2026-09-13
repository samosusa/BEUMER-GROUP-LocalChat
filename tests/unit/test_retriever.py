from datetime import datetime

import faiss
import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.db import Base
from src.models.chunk import Chunk
from src.models.document import Document
from src.models.project import Project  # noqa: F401 - registers `projects` on Base.metadata for create_all
from src.retriever import retrieve


def test_retrieve_orders_chunks_by_similarity(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        document = Document(
            title="Guide", path="guide.txt", checksum="checksum", version=1,
            uploaded_at=datetime.utcnow(),
        )
        db.add(document)
        db.flush()
        db.add_all([
            Chunk(doc_id=document.id, chunk_index=0, text="weak", page=1, section="Intro", created_at=datetime.utcnow()),
            Chunk(doc_id=document.id, chunk_index=1, text="strong", page=2, section="Speed", created_at=datetime.utcnow()),
        ])
        db.commit()

        index = faiss.IndexFlatIP(2)
        index.add(np.asarray([[0.2, 0.98], [1.0, 0.0]], dtype="float32"))
        vector_path = tmp_path / f"{document.id}.index"
        faiss.write_index(index, str(vector_path))
        monkeypatch.setattr("src.retriever.embed_query", lambda texts: [[1.0, 0.0]])

        results = retrieve("question", db, top_k=2, vector_dir=tmp_path)

    assert [result.chunk.text for result in results] == ["strong", "weak"]
    assert results[0].score == 1.0
    assert results[1].score == pytest.approx(0.2)


def test_retrieve_filters_to_documents_in_the_given_project(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        in_project = Document(
            title="In project", path="in.txt", checksum="in", version=1,
            project_id=1, uploaded_at=datetime.utcnow(),
        )
        other_project = Document(
            title="Other project", path="other.txt", checksum="other", version=1,
            project_id=2, uploaded_at=datetime.utcnow(),
        )
        db.add_all([in_project, other_project])
        db.flush()
        db.add_all([
            Chunk(doc_id=in_project.id, chunk_index=0, text="in-project text", created_at=datetime.utcnow()),
            Chunk(doc_id=other_project.id, chunk_index=0, text="other-project text", created_at=datetime.utcnow()),
        ])
        db.commit()

        for document in (in_project, other_project):
            index = faiss.IndexFlatIP(2)
            index.add(np.asarray([[1.0, 0.0]], dtype="float32"))
            faiss.write_index(index, str(tmp_path / f"{document.id}.index"))
        monkeypatch.setattr("src.retriever.embed_query", lambda texts: [[1.0, 0.0]])

        results = retrieve("question", db, top_k=5, vector_dir=tmp_path, project_id=1)

    assert [result.chunk.text for result in results] == ["in-project text"]


def test_retrieve_without_a_project_excludes_project_scoped_documents(tmp_path, monkeypatch):
    """An unscoped query must search the general corpus only, not every project's documents
    - otherwise a document ingested into a project would still leak into every other chat."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        general = Document(
            title="General", path="general.txt", checksum="general", version=1,
            uploaded_at=datetime.utcnow(),
        )
        scoped = Document(
            title="Scoped", path="scoped.txt", checksum="scoped", version=1,
            project_id=1, uploaded_at=datetime.utcnow(),
        )
        db.add_all([general, scoped])
        db.flush()
        db.add_all([
            Chunk(doc_id=general.id, chunk_index=0, text="general text", created_at=datetime.utcnow()),
            Chunk(doc_id=scoped.id, chunk_index=0, text="scoped text", created_at=datetime.utcnow()),
        ])
        db.commit()

        for document in (general, scoped):
            index = faiss.IndexFlatIP(2)
            index.add(np.asarray([[1.0, 0.0]], dtype="float32"))
            faiss.write_index(index, str(tmp_path / f"{document.id}.index"))
        monkeypatch.setattr("src.retriever.embed_query", lambda texts: [[1.0, 0.0]])

        results = retrieve("question", db, top_k=5, vector_dir=tmp_path)

    assert [result.chunk.text for result in results] == ["general text"]


def test_retrieve_without_a_project_includes_also_general_documents(tmp_path, monkeypatch):
    """A document tagged also_general must appear in a general-scoped query even though it
    belongs to a project, while an ordinary project-scoped document still must not."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        also_general = Document(
            title="Also general", path="also.txt", checksum="also", version=1,
            project_id=1, also_general=True, uploaded_at=datetime.utcnow(),
        )
        scoped = Document(
            title="Scoped", path="scoped.txt", checksum="scoped", version=1,
            project_id=1, uploaded_at=datetime.utcnow(),
        )
        db.add_all([also_general, scoped])
        db.flush()
        db.add_all([
            Chunk(doc_id=also_general.id, chunk_index=0, text="also-general text", created_at=datetime.utcnow()),
            Chunk(doc_id=scoped.id, chunk_index=0, text="scoped text", created_at=datetime.utcnow()),
        ])
        db.commit()

        for document in (also_general, scoped):
            index = faiss.IndexFlatIP(2)
            index.add(np.asarray([[1.0, 0.0]], dtype="float32"))
            faiss.write_index(index, str(tmp_path / f"{document.id}.index"))
        monkeypatch.setattr("src.retriever.embed_query", lambda texts: [[1.0, 0.0]])

        results = retrieve("question", db, top_k=5, vector_dir=tmp_path)

    assert [result.chunk.text for result in results] == ["also-general text"]


def test_retrieve_with_include_general_unions_project_and_general_documents(tmp_path, monkeypatch):
    """'Both' mode: a project-scoped query with include_general=True must also surface
    project-less documents, without leaking in other projects' documents."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        general = Document(
            title="General", path="general.txt", checksum="general", version=1,
            uploaded_at=datetime.utcnow(),
        )
        in_project = Document(
            title="In project", path="in.txt", checksum="in", version=1,
            project_id=1, uploaded_at=datetime.utcnow(),
        )
        other_project = Document(
            title="Other project", path="other.txt", checksum="other", version=1,
            project_id=2, uploaded_at=datetime.utcnow(),
        )
        db.add_all([general, in_project, other_project])
        db.flush()
        db.add_all([
            Chunk(doc_id=general.id, chunk_index=0, text="general text", created_at=datetime.utcnow()),
            Chunk(doc_id=in_project.id, chunk_index=0, text="in-project text", created_at=datetime.utcnow()),
            Chunk(doc_id=other_project.id, chunk_index=0, text="other-project text", created_at=datetime.utcnow()),
        ])
        db.commit()

        for document in (general, in_project, other_project):
            index = faiss.IndexFlatIP(2)
            index.add(np.asarray([[1.0, 0.0]], dtype="float32"))
            faiss.write_index(index, str(tmp_path / f"{document.id}.index"))
        monkeypatch.setattr("src.retriever.embed_query", lambda texts: [[1.0, 0.0]])

        results = retrieve(
            "question", db, top_k=5, vector_dir=tmp_path, project_id=1, include_general=True
        )

    assert {result.chunk.text for result in results} == {"in-project text", "general text"}
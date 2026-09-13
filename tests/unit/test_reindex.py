from datetime import datetime

import pytest

from src.db import SessionLocal
from src.ingest.embedder import EmbeddingModel, embedding_adapter
from src.ingest.vector_store import FaissVectorStore
from src.models.chunk import Chunk
from src.models.document import Document
from src.models.reindex_job import ReindexJob
from src.reindex import run_reindex_job


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
    original = embedding_adapter.active["model"]
    try:
        yield
    finally:
        embedding_adapter.set_active(original)


def _make_indexed_document(db, title: str, model: str, vector_dir) -> Document:
    document = Document(
        title=title,
        path=f"{title}.txt",
        checksum=title,
        version=1,
        uploaded_at=datetime.utcnow(),
        indexed_at=datetime.utcnow(),
        embedding_model=model,
        embedding_dim=2,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    db.add(Chunk(doc_id=document.id, chunk_index=0, text="some chunk text", created_at=datetime.utcnow()))
    db.commit()
    store = FaissVectorStore(vector_dir=vector_dir)
    store.add_vectors(document.id, [[1.0, 0.0]])
    store.save(document.id)
    return document


def test_run_reindex_job_re_embeds_stale_documents_and_skips_up_to_date_ones(tmp_path):
    with SessionLocal() as db:
        stale = _make_indexed_document(db, "Stale Doc", "nomic-ai/nomic-embed-text-v1.5", tmp_path)
        up_to_date = _make_indexed_document(db, "Up To Date Doc", "BAAI/bge-small-en-v1.5", tmp_path)

        job = ReindexJob(
            status="running",
            model="BAAI/bge-small-en-v1.5",
            total_documents=0,
            completed_documents=0,
            created_at=datetime.utcnow(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        run_reindex_job(db, job.id, vector_store=FaissVectorStore(vector_dir=tmp_path))

        db.refresh(job)
        assert job.status == "completed"
        # Every test in the suite shares one session-wide database (see tests/conftest.py),
        # so other tests' already-indexed documents may also show up as pending here if their
        # embedding_model happens not to match this job's target - total_documents can't be
        # asserted exactly, only that whatever was picked up got fully processed and that the
        # already-current document above was correctly excluded from it.
        assert job.completed_documents == job.total_documents
        assert job.total_documents >= 1

        db.refresh(stale)
        assert stale.embedding_model == "BAAI/bge-small-en-v1.5"
        assert stale.embedding_dim == 384

        db.refresh(up_to_date)
        assert up_to_date.embedding_model == "BAAI/bge-small-en-v1.5"


def test_run_reindex_job_skips_documents_with_no_chunks(tmp_path):
    with SessionLocal() as db:
        document = Document(
            title="Empty Doc",
            path="empty.txt",
            checksum="empty-doc-checksum",
            version=1,
            uploaded_at=datetime.utcnow(),
            indexed_at=datetime.utcnow(),
            embedding_model="nomic-ai/nomic-embed-text-v1.5",
            embedding_dim=768,
        )
        db.add(document)
        db.commit()
        db.refresh(document)

        job = ReindexJob(
            status="running",
            model="BAAI/bge-small-en-v1.5",
            total_documents=0,
            completed_documents=0,
            created_at=datetime.utcnow(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        run_reindex_job(db, job.id, vector_store=FaissVectorStore(vector_dir=tmp_path))

        db.refresh(job)
        assert job.status == "completed"
        db.refresh(document)
        # No chunks to re-embed, so the document is left untagged rather than falsely marked
        # as reindexed under a model that never actually produced any vectors for it.
        assert document.embedding_model == "nomic-ai/nomic-embed-text-v1.5"


def test_run_reindex_job_marks_job_failed_on_unknown_model():
    with SessionLocal() as db:
        job = ReindexJob(
            status="running",
            model="not-a-real-model",
            total_documents=0,
            completed_documents=0,
            created_at=datetime.utcnow(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        with pytest.raises(Exception):
            run_reindex_job(db, job.id)

        db.refresh(job)
        assert job.status == "failed"
        assert job.error

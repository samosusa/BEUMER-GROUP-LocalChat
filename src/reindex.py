"""Background re-embed harness, same job-row-updated-as-it-goes shape as
src/ingest/pipeline.py and src/benchmark.py: walks every already-indexed document, re-embeds
its stored Chunk.text with the newly-activated embedding model, and rebuilds its FAISS index -
so switching embedding models (see POST /embeddings/active) never leaves old documents' vectors
in a different, now-incompatible space than what new queries get embedded into. No re-parsing
or re-uploading of source files is needed because chunk text is already persisted in the
`chunks` table; only the vectors are stale.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from src.ingest.embedder import embedding_adapter
from src.ingest.pipeline import CHECKPOINT_SIZE
from src.ingest.vector_store import FaissVectorStore
from src.models.chunk import Chunk
from src.models.document import Document
from src.models.reindex_job import ReindexJob


def _get_job(db: Session, job_id: int) -> ReindexJob:
    job = db.get(ReindexJob, job_id)
    if job is None:
        raise ValueError(f"Reindex job {job_id} not found")
    return job


def _mark_failed(db: Session, job_id: int, error: Exception) -> None:
    db.rollback()
    job = db.get(ReindexJob, job_id)
    if job is not None:
        job.status = "failed"
        job.error = str(error)
        job.finished_at = datetime.utcnow()
        db.commit()


def _reindex_document(db: Session, store: FaissVectorStore, document: Document, model: str) -> None:
    chunks = (
        db.query(Chunk)
        .filter(Chunk.doc_id == document.id)
        .order_by(Chunk.chunk_index)
        .all()
    )
    if not chunks:
        return
    for start in range(0, len(chunks), CHECKPOINT_SIZE):
        batch = chunks[start:start + CHECKPOINT_SIZE]
        vectors = embedding_adapter.embed([chunk.text for chunk in batch])
        store.add_vectors(document.id, vectors)
    store.save(document.id)
    active = embedding_adapter.active
    document.embedding_model = model
    document.embedding_dim = active["dimension"]
    db.commit()


def run_reindex_job(db: Session, job_id: int, vector_store: FaissVectorStore | None = None) -> None:
    job = _get_job(db, job_id)
    try:
        # Loads the target model once, up front, rather than lazily on first embed() call -
        # so a failure to load it (bad model name, download failure) fails the job
        # immediately instead of partway through the first document. Any ingestion that
        # starts concurrently while this runs will pick up this same newly-active model,
        # which is the desired behavior: new documents should never be embedded with a model
        # this job is in the middle of retiring.
        embedding_adapter.set_active(job.model)

        documents = db.query(Document).filter(Document.indexed_at.isnot(None)).all()
        pending = [document for document in documents if document.embedding_model != job.model]

        job.total_documents = len(pending)
        job.completed_documents = 0
        db.commit()

        store = vector_store or FaissVectorStore()
        for document in pending:
            job.current_document = document.title
            db.commit()

            _reindex_document(db, store, document, job.model)

            job.completed_documents += 1
            db.commit()

        job.status = "completed"
        job.current_document = None
        job.finished_at = datetime.utcnow()
        db.commit()
    except Exception as error:
        _mark_failed(db, job_id, error)
        raise

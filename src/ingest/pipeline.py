from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from src.complexity import measure_document_complexity
from src.ingest.chunker import TextChunk, chunk_file
from src.ingest.embedder import embed
from src.ingest.vector_store import FaissVectorStore
from src.models.chunk import Chunk
from src.models.document import Document
from src.models.ingestion_job import IngestionJob
from src.utils import file_checksum

CHECKPOINT_SIZE = 50

Embedder = Callable[[list[str]], list[list[float]]]


def _get_job(db: Session, job_id: int) -> IngestionJob:
    job = db.get(IngestionJob, job_id)
    if job is None:
        raise ValueError(f"Ingestion job {job_id} not found")
    return job


def _create_document(
    db: Session, job: IngestionJob, title: str, path: Path, project_id: int | None
) -> tuple[Document, list[TextChunk]]:
    chunks = chunk_file(path)
    complexity = measure_document_complexity(" ".join(chunk.text for chunk in chunks))
    document = Document(
        title=title,
        path=str(path),
        checksum=file_checksum(path),
        version=1,
        project_id=project_id,
        uploaded_at=datetime.utcnow(),
        complexity_tier=complexity.tier,
        complexity_score=complexity.score,
    )
    db.add(document)
    db.flush()
    job.total_chunks = len(chunks)
    db.commit()
    return document, chunks


def _index_chunk_batch(
    db: Session,
    document: Document,
    job: IngestionJob,
    store: FaissVectorStore,
    embedder: Embedder,
    batch: list[TextChunk],
    start: int,
    total_chunks: int,
) -> None:
    vectors = embedder([chunk.text for chunk in batch])
    if len(vectors) != len(batch):
        raise ValueError("Embedder returned a different number of vectors than chunks")
    store.add_vectors(document.id, vectors)
    vector_path = store.path_for(document.id)
    now = datetime.utcnow()
    db.add_all(
        Chunk(
            doc_id=document.id,
            chunk_index=chunk.chunk_index,
            text=chunk.text,
            page=chunk.page,
            section=chunk.section,
            embedding_path=str(vector_path),
            created_at=now,
        )
        for chunk in batch
    )
    job.offset = start + len(batch)
    job.last_checkpoint = {"offset": job.offset, "total_chunks": total_chunks}
    db.commit()


def _finalize(db: Session, document: Document, job: IngestionJob, store: FaissVectorStore, total_chunks: int) -> None:
    store.save(document.id)
    job.offset = total_chunks
    job.last_checkpoint = {"offset": total_chunks, "total_chunks": total_chunks}
    document.indexed_at = datetime.utcnow()
    job.status = "completed"
    db.commit()


def _mark_failed(db: Session, job_id: int, error: Exception) -> None:
    db.rollback()
    job = db.get(IngestionJob, job_id)
    if job is not None:
        job.status = "failed"
        job.last_checkpoint = {"error": str(error)}
        db.commit()


def run_pipeline(
    db: Session,
    job_id: int,
    title: str,
    source_path: str | Path,
    embedder: Embedder = embed,
    vector_store: FaissVectorStore | None = None,
    project_id: int | None = None,
) -> None:
    path = Path(source_path)
    job = _get_job(db, job_id)

    try:
        document, chunks = _create_document(db, job, title, path, project_id)
        store = vector_store or FaissVectorStore()
        for start in range(0, len(chunks), CHECKPOINT_SIZE):
            batch = chunks[start:start + CHECKPOINT_SIZE]
            _index_chunk_batch(db, document, job, store, embedder, batch, start, len(chunks))
        _finalize(db, document, job, store, len(chunks))
    except Exception as error:
        _mark_failed(db, job_id, error)
        raise
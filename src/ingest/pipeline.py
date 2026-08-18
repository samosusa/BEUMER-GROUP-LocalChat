from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from src.ingest.chunker import TextChunk, chunk_file
from src.ingest.embedder import embed
from src.ingest.vector_store import FaissVectorStore
from src.models.chunk import Chunk
from src.models.document import Document
from src.models.ingestion_job import IngestionJob


CHECKPOINT_SIZE = 50


def checksum_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run_pipeline(
    db: Session,
    job_id: int,
    title: str,
    source_path: str | Path,
    embedder: Callable[[list[str]], list[list[float]]] = embed,
    vector_store: FaissVectorStore | None = None,
) -> None:
    path = Path(source_path)
    job = db.get(IngestionJob, job_id)
    if job is None:
        raise ValueError(f"Ingestion job {job_id} not found")

    try:
        document = Document(
            title=title,
            path=str(path),
            checksum=checksum_file(path),
            version=1,
            uploaded_at=datetime.utcnow(),
        )
        db.add(document)
        db.flush()
        chunks = chunk_file(path)
        job.total_chunks = len(chunks)
        db.commit()

        store = vector_store or FaissVectorStore()
        vector_path = store.path_for(document.id)
        for start in range(0, len(chunks), CHECKPOINT_SIZE):
            batch = chunks[start:start + CHECKPOINT_SIZE]
            vectors = embedder([chunk.text for chunk in batch])
            if len(vectors) != len(batch):
                raise ValueError("Embedder returned a different number of vectors than chunks")
            store.add_vectors(document.id, vectors)
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
            job.last_checkpoint = {"offset": job.offset, "total_chunks": len(chunks)}
            db.commit()

        store.save(document.id)
        now = datetime.utcnow()
        job.offset = len(chunks)
        job.last_checkpoint = {"offset": len(chunks), "total_chunks": len(chunks)}
        document.indexed_at = now
        job.status = "completed"
        db.commit()
    except Exception as error:
        db.rollback()
        job = db.get(IngestionJob, job_id)
        if job is not None:
            job.status = "failed"
            job.last_checkpoint = {"error": str(error)}
            db.commit()
        raise
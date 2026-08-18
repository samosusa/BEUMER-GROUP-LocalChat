from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import faiss
import numpy as np
from sqlalchemy.orm import Session

from src.ingest.embedder import embed_query
from src.ingest.vector_store import VECTOR_DIR
from src.models.chunk import Chunk
from src.models.document import Document


@dataclass(frozen=True)
class RetrievedChunk:
    chunk: Chunk
    document: Document
    score: float


def retrieve(
    query: str,
    db: Session,
    top_k: int = 5,
    vector_dir: Path = VECTOR_DIR,
) -> list[RetrievedChunk]:
    if top_k <= 0 or not query.strip():
        return []

    query_vector = np.asarray(embed_query([query]), dtype="float32")
    results: list[RetrievedChunk] = []
    for index_path in vector_dir.glob("*.index"):
        try:
            doc_id = int(index_path.stem)
        except ValueError:
            continue
        index = faiss.read_index(str(index_path))
        if index.ntotal == 0 or index.d != query_vector.shape[1]:
            continue
        scores, indices = index.search(query_vector, min(top_k, index.ntotal))
        chunks = {
            chunk.chunk_index: chunk
            for chunk in db.query(Chunk).filter(Chunk.doc_id == doc_id).all()
        }
        document = db.get(Document, doc_id)
        if document is None:
            continue
        for score, chunk_index in zip(scores[0], indices[0]):
            chunk = chunks.get(int(chunk_index))
            if chunk is not None and chunk_index >= 0:
                results.append(RetrievedChunk(chunk, document, float(score)))

    results.sort(key=lambda result: result.score, reverse=True)
    return results[:top_k]


def retrieve_chunks(query: str, db: Session, top_k: int = 5) -> list[RetrievedChunk]:
    return retrieve(query, db, top_k=top_k)
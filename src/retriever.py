from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

import faiss
import numpy as np
from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.ingest.embedder import embed_query, embedding_adapter
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
    vector_dir: Path | None = None,
    project_id: int | None = None,
    include_general: bool = False,
) -> list[RetrievedChunk]:
    if top_k <= 0 or not query.strip():
        return []

    query_vector = np.asarray(embed_query([query]), dtype="float32")
    vector_dir = vector_dir or Path(os.getenv("LOCALCHAT_VECTOR_DIR", VECTOR_DIR))

    # A document is part of the general corpus if it has no project of its own, or if it was
    # explicitly opted into general visibility (also_general) despite belonging to a project.
    general_clause = or_(Document.project_id.is_(None), Document.also_general.is_(True))

    # project_id is None here means "the general corpus" - not "every document regardless of
    # project". `include_general` is "both" mode: a project-scoped query that should also draw
    # on the general corpus, so the filter widens instead of narrowing to one or the other.
    if project_id is None:
        document_filter = general_clause
    elif include_general:
        document_filter = or_(Document.project_id == project_id, general_clause)
    else:
        document_filter = Document.project_id == project_id
    allowed_doc_ids = {
        doc_id for (doc_id,) in db.query(Document.id).filter(document_filter).all()
    }

    active_model = embedding_adapter.active["model"]

    results: list[RetrievedChunk] = []
    for index_path in vector_dir.glob("*.index"):
        try:
            doc_id = int(index_path.stem)
        except ValueError:
            continue
        if doc_id not in allowed_doc_ids:
            continue
        document = db.get(Document, doc_id)
        if document is None:
            continue
        # A document embedded under a different model than the one currently active isn't
        # just a different dimension away from being comparable - even at the same
        # dimension its vectors live in a different geometric space, so cosine/dot-product
        # scores against it would be meaningless rather than merely stale. Skip it here
        # (rather than in the query step below) so it's excluded before it can ever be
        # searched, until a re-embed (see src/reindex.py) brings it back in step.
        if document.embedding_model is not None and document.embedding_model != active_model:
            continue
        index = faiss.read_index(str(index_path))
        if index.ntotal == 0 or index.d != query_vector.shape[1]:
            continue
        scores, indices = index.search(query_vector, min(top_k, index.ntotal))
        chunks = {
            chunk.chunk_index: chunk
            for chunk in db.query(Chunk).filter(Chunk.doc_id == doc_id).all()
        }
        for score, chunk_index in zip(scores[0], indices[0]):
            chunk = chunks.get(int(chunk_index))
            if chunk is not None and chunk_index >= 0:
                results.append(RetrievedChunk(chunk, document, float(score)))

    results.sort(key=lambda result: result.score, reverse=True)
    return results[:top_k]


def retrieve_chunks(
    query: str,
    db: Session,
    top_k: int = 5,
    project_id: int | None = None,
    include_general: bool = False,
) -> list[RetrievedChunk]:
    return retrieve(query, db, top_k=top_k, project_id=project_id, include_general=include_general)
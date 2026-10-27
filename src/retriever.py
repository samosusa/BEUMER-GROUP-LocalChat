from __future__ import annotations

from dataclasses import dataclass
import math
import os
import re
from collections import Counter
from pathlib import Path
from typing import Callable, Hashable

import faiss
import numpy as np
from sqlalchemy import or_
from sqlalchemy.orm import Session

from src import rag_config
from src.fusion import reciprocal_rank_fusion
from src.ingest.embedder import embed_query, embedding_adapter
from src.ingest.vector_store import VECTOR_DIR
from src.models.chunk import Chunk
from src.models.document import Document


@dataclass(frozen=True)
class RetrievedChunk:
    chunk: Chunk
    document: Document
    score: float


# ---------------------------------------------------------------------------------------
# Keyword search (BM25)
#
# Embeddings are good at meaning and bad at exact strings: a part number, an error code or
# a product name like "MSC800" or "CrisBelt" barely moves a 768-dimensional vector, so the
# passage that literally contains it can rank below a passage that is merely on the same
# topic. BM25 ranks by exact term overlap, weighted by how rare each term is, which is the
# opposite strength. Hybrid search runs both and merges the rankings with RRF.
# ---------------------------------------------------------------------------------------

BM25_K1 = 1.5
BM25_B = 0.75

# Latin letters including the accented range, so Danish "æ", "ø" and "å" stay inside words.
_TOKEN_RE = re.compile(r"[a-z0-9À-ɏ]+(?:[-_.][a-z0-9À-ɏ]+)*")
_KEYWORD_STOPWORDS = frozenset(
    """a an the and or but so of to in on at for from by with about as into is are was were be
    been being do does did can could should would will shall may might must it its this that
    these those there their they them he she his her you your we our i me my what which who whom
    whose when where why how not no yes than then also any each every all some""".split()
)


def keyword_tokens(text: str) -> list[str]:
    return [token for token in _TOKEN_RE.findall(text.lower()) if token not in _KEYWORD_STOPWORDS]


def bm25_rank(
    query: str, documents: list[tuple[Hashable, str]], k1: float = BM25_K1, b: float = BM25_B
) -> list[tuple[Hashable, float]]:
    """BM25 scores for every (key, text) pair that shares at least one term with the query,
    best first. Pure Python: the corpus is already loaded per query for the vector search,
    and at the corpus sizes this app targets an inverted index would not pay for itself."""
    query_terms = set(keyword_tokens(query))
    if not query_terms or not documents:
        return []
    tokenized = [(key, keyword_tokens(text)) for key, text in documents]
    count = len(tokenized)
    average_length = sum(len(tokens) for _, tokens in tokenized) / count or 1.0
    document_frequency = Counter(term for _, tokens in tokenized for term in set(tokens) if term in query_terms)

    scored = []
    for key, tokens in tokenized:
        frequencies = Counter(token for token in tokens if token in query_terms)
        if not frequencies:
            continue
        length_norm = k1 * (1 - b + b * len(tokens) / average_length)
        score = 0.0
        for term, frequency in frequencies.items():
            df = document_frequency[term]
            idf = math.log((count - df + 0.5) / (df + 0.5) + 1)
            score += idf * frequency * (k1 + 1) / (frequency + length_norm)
        scored.append((key, score))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored


def retrieve(
    query: str,
    db: Session,
    top_k: int = 5,
    vector_dir: Path | None = None,
    project_id: int | None = None,
    include_general: bool = False,
    embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
    doc_ids: set[int] | None = None,
    hybrid: bool | None = None,
) -> list[RetrievedChunk]:
    if top_k <= 0 or not query.strip():
        return []
    if hybrid is None:
        hybrid = rag_config.get().hybrid

    # Not a default parameter value (`embed_fn: ... = embed_query`): that would bind to
    # whatever `embed_query` was at import time, which would silently stop honoring
    # `monkeypatch.setattr("src.retriever.embed_query", ...)` in tests/unit/test_retriever.py
    # and any other caller that relies on patching the module-level name instead of passing
    # embed_fn. Looking it up here keeps that late-binding intact for every existing caller,
    # while still letting src/vector_capacity_benchmark.py inject a fake embedder explicitly -
    # the only safe way to fake retrieval from a background job that may run alongside real
    # traffic in the same process, where mutating a global would corrupt a real query too.
    embed = embed_fn or embed_query
    query_vector = np.asarray(embed([query]), dtype="float32")
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
    # Narrows within the scope, never widens past it: a document outside the scope chosen for
    # this turn stays out even when the caller names it.
    if doc_ids is not None:
        allowed_doc_ids &= doc_ids

    active_model = embedding_adapter.active["model"]

    results: list[RetrievedChunk] = []
    searchable: list[tuple[Document, dict[int, Chunk], object]] = []
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
        if hybrid:
            searchable.append((document, chunks, index))

    results.sort(key=lambda result: result.score, reverse=True)
    if not hybrid:
        return results[:top_k]
    keyword_results = _keyword_search(query, query_vector, searchable, top_k)
    if not keyword_results:
        return results[:top_k]
    return reciprocal_rank_fusion([results, keyword_results], k=rag_config.get().rrf_k)[:top_k]


def _keyword_search(
    query: str, query_vector: np.ndarray, searchable: list[tuple[Document, dict[int, Chunk], object]], top_k: int
) -> list[RetrievedChunk]:
    """BM25 over every chunk the vector search was allowed to see, best `top_k` first.

    Each keyword hit still carries a cosine score, read back from the document's own FAISS
    index, so everything downstream that thresholds on similarity (MIN_SIMILARITY, the
    relative cutoff) treats keyword hits and vector hits on the same scale."""
    by_key = {
        (document.id, chunk_index): (document, chunk, index)
        for document, chunks, index in searchable
        for chunk_index, chunk in chunks.items()
    }
    ranked = bm25_rank(query, [(key, chunk.text) for key, (_, chunk, _) in by_key.items()])[:top_k]
    hits = []
    for key, _ in ranked:
        document, chunk, index = by_key[key]
        if not 0 <= chunk.chunk_index < index.ntotal:
            continue
        vector = index.reconstruct(int(chunk.chunk_index))
        hits.append(RetrievedChunk(chunk, document, float(np.dot(vector, query_vector[0]))))
    return hits


def retrieve_chunks(
    query: str,
    db: Session,
    top_k: int = 5,
    project_id: int | None = None,
    include_general: bool = False,
    doc_ids: set[int] | None = None,
) -> list[RetrievedChunk]:
    return retrieve(
        query, db, top_k=top_k, project_id=project_id, include_general=include_general, doc_ids=doc_ids
    )
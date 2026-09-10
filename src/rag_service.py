from __future__ import annotations

from sqlalchemy.orm import Session

from src import llm_adapter
from src.complexity import TIER_PARAMS, measure_complexity
from src.retriever import RetrievedChunk, retrieve_chunks

MIN_SIMILARITY = 0.35

# Token headroom reserved beyond the generation budget, covering BOS and formatting slop,
# so prompt_tokens + max_tokens never bumps against the model's context window.
CONTEXT_SAFETY_MARGIN = 32


def build_prompt(question: str, retrieved: list[RetrievedChunk]) -> str:
    context = "\n\n".join(
        f"[{index}] {item.document.title} | section: {item.chunk.section or 'Unknown'} | "
        f"page: {item.chunk.page or 'Unknown'}\n{item.chunk.text}"
        for index, item in enumerate(retrieved, start=1)
    )
    return (
        "You answer questions using only the provided documentation. "
        "If the documentation does not contain the answer, say that it is not available. "
        "Answer directly in plain prose: no source numbers, citations, or "
        "'Question:'/'Answer:' labels in your reply, since sources are already "
        "shown separately.\n\n"
        f"Documentation:\n{context}\n\nQuestion: {question}\nAnswer:"
    )


def _fit_to_context(
    question: str, retrieved: list[RetrievedChunk], max_tokens: int
) -> tuple[list[RetrievedChunk], str, dict]:
    """Counts the built prompt against the active model's real context window and, if it
    doesn't fit alongside the requested generation budget, drops the weakest-scoring
    chunks (retrieved is already sorted best-first) until it does - or until one chunk is
    left, at which point it's sent as-is rather than dropping the last piece of evidence."""
    n_ctx = llm_adapter.context_size()
    budget = max(n_ctx - max_tokens - CONTEXT_SAFETY_MARGIN, 0)

    working = list(retrieved)
    chunks_dropped = 0
    prompt = build_prompt(question, working)
    prompt_tokens = llm_adapter.count_tokens(prompt)

    while prompt_tokens > budget and len(working) > 1:
        working = working[:-1]
        chunks_dropped += 1
        prompt = build_prompt(question, working)
        prompt_tokens = llm_adapter.count_tokens(prompt)

    context_info = {
        "n_ctx": n_ctx,
        "prompt_tokens": prompt_tokens,
        "max_tokens": max_tokens,
        "chunks_dropped": chunks_dropped,
        "fits": prompt_tokens <= budget,
    }
    return working, prompt, context_info


def answer(
    question: str,
    db: Session,
    top_k: int | None = None,
    max_tokens: int | None = None,
    project_id: int | None = None,
    include_general: bool = False,
) -> dict:
    # top_k/max_tokens default to None so a per-query difficulty score - not a single
    # fixed pair - picks retrieval depth and generation budget; an explicit caller-supplied
    # value (e.g. from a future admin override) always wins over the heuristic.
    complexity = measure_complexity(question)
    tier_params = TIER_PARAMS[complexity.tier]
    resolved_top_k = top_k if top_k is not None else tier_params["top_k"]
    resolved_max_tokens = max_tokens if max_tokens is not None else tier_params["max_tokens"]

    retrieved = retrieve_chunks(
        question, db, top_k=resolved_top_k, project_id=project_id, include_general=include_general
    )
    if not retrieved or retrieved[0].score < MIN_SIMILARITY:
        return {
            "answer": None,
            "citations": [],
            "not_found": True,
            "suggestion": "Try a more specific question about the ingested project documentation.",
            "complexity": {"tier": complexity.tier, "score": complexity.score},
        }

    fitted, prompt, context_info = _fit_to_context(question, retrieved, resolved_max_tokens)
    generated = llm_adapter.generate(prompt, max_tokens=resolved_max_tokens)
    citations = [
        {
            "title": item.document.title,
            "section": item.chunk.section,
            "page": item.chunk.page,
            "score": item.score,
        }
        for item in fitted
    ]
    return {
        "answer": generated,
        "citations": citations,
        "not_found": False,
        "complexity": {"tier": complexity.tier, "score": complexity.score},
        "context": context_info,
    }
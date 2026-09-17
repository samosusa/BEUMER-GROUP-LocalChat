from __future__ import annotations

from sqlalchemy.orm import Session

from src import llm_adapter
from src.complexity import TIER_PARAMS, measure_complexity
from src.retriever import RetrievedChunk, retrieve_chunks

MIN_SIMILARITY = 0.35

# Token headroom reserved beyond the generation budget, covering BOS and formatting slop,
# so prompt_tokens + max_tokens never bumps against the model's context window.
CONTEXT_SAFETY_MARGIN = 32

# How many prior user/assistant turns a follow-up question can draw on - both to widen the
# retrieval query (so "his hobbies" still carries "Samo Susa" into the embedding search)
# and to give the model enough of the prior exchange to resolve pronouns in its answer.
# Kept small: these are the turns most likely to still be what "his"/"it"/"that" refers to,
# and every turn included is budget _fit_to_context can no longer spend on evidence chunks.
HISTORY_TURNS = 3

History = list[tuple[str, str]]


def _expand_retrieval_query(question: str, history: History) -> str:
    """Follow-up questions like "what are his hobbies?" carry no entity of their own -
    embedded alone, the query has nothing to anchor the FAISS search to the right document
    out of many similar ones. Prefixing the recent user questions restores that anchor
    (e.g. "Samo Susa") without a separate LLM coreference-resolution call. Only prior
    *questions* are used here (not answers) - the goal is carrying forward the subject
    being asked about, not pulling in prose that would dilute the embedding."""
    if not history:
        return question
    prior_questions = [asked for asked, _ in history]
    return "\n".join([*prior_questions, question])


def _format_history(history: History) -> str:
    turns = "\n\n".join(f"Question: {asked}\nAnswer: {answered}" for asked, answered in history)
    return f"Earlier in this conversation:\n{turns}\n\n"


def build_prompt(question: str, retrieved: list[RetrievedChunk], history: History | None = None) -> str:
    context = "\n\n".join(
        f"[{index}] {item.document.title} | section: {item.chunk.section or 'Unknown'} | "
        f"page: {item.chunk.page or 'Unknown'}\n{item.chunk.text}"
        for index, item in enumerate(retrieved, start=1)
    )
    history_block = _format_history(history) if history else ""
    pronoun_note = (
        " Use the earlier conversation only to work out who or what a pronoun in the "
        "question refers to - answer from the documentation, not by repeating earlier turns."
        if history
        else ""
    )
    return (
        "You answer questions using only the provided documentation. "
        "If the documentation does not contain the answer, say that it is not available."
        f"{pronoun_note} "
        "Answer directly in plain prose: no source numbers, citations, or "
        "'Question:'/'Answer:' labels in your reply, since sources are already "
        "shown separately.\n\n"
        f"{history_block}"
        f"Documentation:\n{context}\n\nQuestion: {question}\nAnswer:"
    )


def _fit_to_context(
    question: str, retrieved: list[RetrievedChunk], max_tokens: int, history: History | None = None
) -> tuple[list[RetrievedChunk], str, dict]:
    """Counts the built prompt against the active model's real context window and, if it
    doesn't fit alongside the requested generation budget, sheds tokens until it does:
    oldest conversation history first (it only helps phrasing/pronoun resolution), then
    the weakest-scoring chunks (retrieved is already sorted best-first) - or until one
    chunk is left, at which point it's sent as-is rather than dropping the last piece of
    evidence. Evidence outranks history because the chunks are what actually answers the
    question; history is dead weight next to a question they no longer inform."""
    n_ctx = llm_adapter.context_size()
    budget = max(n_ctx - max_tokens - CONTEXT_SAFETY_MARGIN, 0)

    working = list(retrieved)
    working_history = list(history or [])
    chunks_dropped = 0
    history_turns_dropped = 0
    prompt = build_prompt(question, working, working_history)
    prompt_tokens = llm_adapter.count_tokens(prompt)

    while prompt_tokens > budget and working_history:
        working_history = working_history[1:]
        history_turns_dropped += 1
        prompt = build_prompt(question, working, working_history)
        prompt_tokens = llm_adapter.count_tokens(prompt)

    while prompt_tokens > budget and len(working) > 1:
        working = working[:-1]
        chunks_dropped += 1
        prompt = build_prompt(question, working, working_history)
        prompt_tokens = llm_adapter.count_tokens(prompt)

    context_info = {
        "n_ctx": n_ctx,
        "prompt_tokens": prompt_tokens,
        "max_tokens": max_tokens,
        "chunks_dropped": chunks_dropped,
        "history_turns_dropped": history_turns_dropped,
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
    history: History | None = None,
) -> dict:
    # top_k/max_tokens default to None so a per-query difficulty score - not a single
    # fixed pair - picks retrieval depth and generation budget; an explicit caller-supplied
    # value (e.g. from a future admin override) always wins over the heuristic.
    complexity = measure_complexity(question)
    tier_params = TIER_PARAMS[complexity.tier]
    resolved_top_k = top_k if top_k is not None else tier_params["top_k"]
    resolved_max_tokens = max_tokens if max_tokens is not None else tier_params["max_tokens"]
    recent_history = (history or [])[-HISTORY_TURNS:]

    retrieval_query = _expand_retrieval_query(question, recent_history)
    retrieved = retrieve_chunks(
        retrieval_query, db, top_k=resolved_top_k, project_id=project_id, include_general=include_general
    )
    if not retrieved or retrieved[0].score < MIN_SIMILARITY:
        return {
            "answer": None,
            "citations": [],
            "not_found": True,
            "suggestion": "Try a more specific question about the ingested project documentation.",
            "complexity": {"tier": complexity.tier, "score": complexity.score},
        }

    fitted, prompt, context_info = _fit_to_context(question, retrieved, resolved_max_tokens, recent_history)
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
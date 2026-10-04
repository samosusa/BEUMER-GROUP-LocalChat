from __future__ import annotations

import re

from sqlalchemy.orm import Session

from src import llm_adapter
from src.complexity import TIER_PARAMS, QueryComplexity, measure_complexity
from src.conversation_context import ResolvedQuery, looks_like_followup, resolve_search_query
from src.retriever import RetrievedChunk, retrieve_chunks

MIN_SIMILARITY = 0.35

# A follow-up stays on the previous answer's document while that document's best match
# scores at least this fraction of the best match elsewhere (see _keep_focus). Relative, so
# it does not depend on the embedding model's score scale. Measured on follow-ups: a
# continuation ("and its speed limit in the aisles?") kept its document at 0.86-0.98 of the
# best other one; a turn naming a different subject ("what about <other person>?") put the
# old one at about 0.6.
FOCUS_KEEP_RATIO = 0.75

NOT_FOUND_SUGGESTION = "Try a more specific question about the ingested project documentation."

# How a model says "the documentation doesn't cover this" in its own words. Matched only at
# the start of a short reply with no "but"/"however" in it, so an answer that admits one gap
# and then answers the rest is never thrown away as a refusal.
#
# Not a fixed sentinel sentence the prompt asks for: tried, and with raw completion the 3B
# default model glued that sentence onto real answers ("cat makes sounds like meow. The
# answer is not available in the documentation.") instead of using it in place of one.
REFUSAL_MAX_CHARS = 200
_REFUSAL_RE = re.compile(
    r"^(?:(?:i'm |i am )?sorry,?\s*|unfortunately,?\s*)?(?:"
    r"i (?:do not|don't|did not|didn't|could not|couldn't|cannot|can't) (?:have|find|see|locate)"
    r"|i(?: am|'m) (?:not able|unable|not available)"
    r"|(?:the |this )?(?:provided )?(?:documentation|documents?|context|text) "
    r"(?:does not|doesn't|do not|don't) (?:contain|mention|include|provide|say|have)"
    r"|there (?:is|are) no (?:information|mention|details?|data)"
    r"|no (?:information|mention|details?)"
    r"|(?:(?:the |this |that )?(?:answer|information)|it|that|this)(?: is|'s) not "
    r"(?:available|provided|mentioned|specified)"
    r"|not (?:available|provided|mentioned|specified)"
    r")\b",
    re.IGNORECASE,
)
_CONTRAST_RE = re.compile(r"\b(?:but|however|although)\b", re.IGNORECASE)

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


def is_refusal(text: str | None) -> bool:
    """True when a generated reply is the model declining to answer rather than an answer."""
    if not text:
        return False
    normalized = " ".join(text.split()).replace("’", "'")
    if len(normalized) > REFUSAL_MAX_CHARS or _CONTRAST_RE.search(normalized):
        return False
    return bool(_REFUSAL_RE.match(normalized))


def _not_found(complexity: QueryComplexity, search_info: dict, context_info: dict | None = None) -> dict:
    result = {
        "answer": None,
        "citations": [],
        "not_found": True,
        "suggestion": NOT_FOUND_SUGGESTION,
        "complexity": {"tier": complexity.tier, "score": complexity.score},
        "search": search_info,
    }
    if context_info is not None:
        result["context"] = context_info
    return result


def _keep_focus(
    retrieved: list[RetrievedChunk], focus_hits: list[RetrievedChunk], top_k: int
) -> list[RetrievedChunk]:
    """Evidence for a follow-up, while the conversation is still about the focus document
    (the previous answer's top source): half the slots go to it, listed first, the rest to
    the best matches anywhere in scope.

    A follow-up continues what was just discussed, but its own words often say too little
    to find it again - "and its weight?", "where did they work?", or a rewrite the model got
    wrong - so a corpus-wide search alone hands those slots to whichever similar document
    scores highest. The search in the focus document still uses this turn's query, so it
    picks that document's chunk about weight rather than repeating the chunk already
    answered from. Listing it first keeps it the top source, and so the focus, for the next
    follow-up too; otherwise a near-tie lost on one turn would move the focus for the rest.

    A follow-up that moves on ("what about the other model?") is recognised by the focus
    document no longer coming close: its best chunk scoring under FOCUS_KEEP_RATIO of the
    best one elsewhere. Then the corpus-wide results are used as they are, and the focus
    passes to whatever they rank first.
    """
    def key(item: RetrievedChunk) -> tuple[int, int]:
        return item.document.id, item.chunk.chunk_index

    focus_ids = {item.document.id for item in focus_hits}
    best_elsewhere = max((item.score for item in retrieved if item.document.id not in focus_ids), default=0.0)
    if not focus_hits or focus_hits[0].score < FOCUS_KEEP_RATIO * best_elsewhere:
        return retrieved

    focus = focus_hits[: (top_k + 1) // 2]
    taken = {key(item) for item in focus}
    rest = [item for item in retrieved if key(item) not in taken][: top_k - len(focus)]
    return focus + rest


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
    focus_doc_ids: list[int] | None = None,
) -> dict:
    # top_k/max_tokens default to None so a per-query difficulty score - not a single
    # fixed pair - picks retrieval depth and generation budget; an explicit caller-supplied
    # value (e.g. from a future admin override) always wins over the heuristic.
    recent_history = (history or [])[-HISTORY_TURNS:]

    # Retrieval gets a standalone rewrite; generation still gets the user's own words plus
    # the dialogue (see build_prompt). One string cannot serve both - that is what
    # src/conversation_context.py exists to explain and fix.
    resolved = resolve_search_query(question, recent_history)
    search_query = resolved.search_query

    # Complexity is scored on what is actually being asked, not on how little of it the
    # user had to type. "And why?" is a one-word question and a complex one; scoring the
    # raw text would hand it the retrieval depth of a single-fact lookup.
    complexity = measure_complexity(search_query)
    tier_params = TIER_PARAMS[complexity.tier]
    resolved_top_k = top_k if top_k is not None else tier_params["top_k"]
    resolved_max_tokens = max_tokens if max_tokens is not None else tier_params["max_tokens"]

    retrieved = retrieve_chunks(
        search_query, db, top_k=resolved_top_k, project_id=project_id, include_general=include_general
    )

    # A rewrite is a guess about what the user meant. When the guess retrieves nothing
    # usable, the literal question is still better evidence of intent than a rewrite this
    # corpus does not recognise - so try it before giving up, and record which one won.
    if resolved.rewritten and (not retrieved or retrieved[0].score < MIN_SIMILARITY):
        literal = retrieve_chunks(
            question, db, top_k=resolved_top_k, project_id=project_id, include_general=include_general
        )
        if literal and (not retrieved or literal[0].score > retrieved[0].score):
            retrieved = literal
            search_query = question
            resolved = ResolvedQuery(question, False, "rewrite retrieved nothing; used the original")

    # Carried into the response so a wrong answer can be attributed to retrieval or to
    # generation. Without it, a follow-up that searched for the wrong thing is
    # indistinguishable from one where the documentation simply did not have the answer.
    search_info = {"query": search_query, "rewritten": resolved.rewritten, "reason": resolved.reason}

    if not retrieved or retrieved[0].score < MIN_SIMILARITY:
        return _not_found(complexity, search_info)

    is_followup = looks_like_followup(question)
    if focus_doc_ids and is_followup:
        focus_hits = retrieve_chunks(
            search_query, db, top_k=resolved_top_k, project_id=project_id,
            include_general=include_general, doc_ids=set(focus_doc_ids),
        )
        retrieved = _keep_focus(retrieved, focus_hits, resolved_top_k)

    # History is in the answer prompt to resolve "he"/"it"/"that" - the same job it does for
    # retrieval above, so it is gated the same way. A question that already stands on its own
    # has nothing to resolve, and small models copy the shape of earlier answers onto it
    # instead of reading the documentation: one earlier "I don't have any information about
    # X." made Llama 3.2 1B/3B, Qwen2.5 3B and Phi-4-mini refuse a later question about X in
    # every run, with X's document retrieved first. Turns that found nothing arrive with an
    # empty answer (see src/api/conversations.py): the rewriter above still needs to know
    # they were asked, but an answer prompt has nothing to learn from a question with none.
    prompt_history = [turn for turn in recent_history if turn[1]] if is_followup else []

    fitted, prompt, context_info = _fit_to_context(question, retrieved, resolved_max_tokens, prompt_history)
    generated = llm_adapter.generate(prompt, max_tokens=resolved_max_tokens)

    # Clearing MIN_SIMILARITY only means a chunk was close enough to be worth reading, not
    # that it holds the answer. When the model reads them and says so, this is a miss like
    # any other: listing those chunks as sources would claim evidence for an answer that was
    # never given.
    if is_refusal(generated):
        return _not_found(complexity, search_info, context_info)

    citations = [
        {
            "doc_id": item.document.id,
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
        "search": search_info,
    }
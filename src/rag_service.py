from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from src import llm_adapter, rag_config
from src.complexity import TIER_PARAMS, QueryComplexity, measure_complexity
from src.conversation_context import (
    ResolvedQuery,
    first_sentence,
    looks_like_followup,
    resolve_search_query,
)
from src.fusion import reciprocal_rank_fusion
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
    # Compact mode keeps each earlier question whole - it is what a pronoun points back to -
    # but only the opening sentence of each earlier answer, so earlier turns cannot crowd
    # out the documentation and the model has less earlier prose to copy from.
    compact = rag_config.get().history_mode == "compact"
    turns = "\n\n".join(
        f"Question: {asked}\nAnswer: {first_sentence(answered) if compact else answered}"
        for asked, answered in history
    )
    return f"Earlier in this conversation:\n{turns}\n\n"


def select_by_relative_score(
    candidates: list[RetrievedChunk], ratio: float, min_chunks: int, max_chunks: int
) -> list[RetrievedChunk]:
    """Decides how many passages a question gets from how well they matched, instead of
    guessing from the question's wording beforehand.

    Keeps every candidate scoring at least `ratio` x the best score, in the candidates'
    order, capped at `max_chunks`. If fewer than `min_chunks` qualify, the next candidates
    fill up to the minimum. One clear winner (0.82, 0.51, 0.48) yields the minimum of 2; a
    flat run of close scores (0.71, 0.69, 0.68, 0.66, 0.64) keeps all five."""
    if not candidates:
        return []
    best = max(item.score for item in candidates)
    selected = [item for item in candidates if item.score >= ratio * best][:max_chunks]
    for item in candidates:
        if len(selected) >= min_chunks:
            break
        if item not in selected:
            selected.append(item)
    return selected


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


@dataclass
class Evidence:
    """Everything retrieval decided for one turn, before any answer is generated.

    Split out of answer() so the benchmarks can measure retrieval on its own - which
    passages a question gets, and how many - without paying for a generation per question."""

    resolved: ResolvedQuery
    complexity: QueryComplexity
    max_tokens: int
    candidates: list[RetrievedChunk]
    selected: list[RetrievedChunk]
    search_info: dict
    retrieval_info: dict = field(default_factory=dict)
    found: bool = True


def gather_evidence(
    question: str,
    db: Session,
    top_k: int | None = None,
    max_tokens: int | None = None,
    project_id: int | None = None,
    include_general: bool = False,
    history: History | None = None,
    focus_doc_ids: list[int] | None = None,
) -> Evidence:
    settings = rag_config.get()
    recent_history = (history or [])[-HISTORY_TURNS:]

    # Retrieval gets a standalone rewrite; generation still gets the user's own words plus
    # the dialogue (see build_prompt). One string cannot serve both - that is what
    # src/conversation_context.py exists to explain and fix.
    resolved = resolve_search_query(question, recent_history)
    search_query = resolved.search_query

    # Complexity is scored on what is actually being asked, not on how little of it the
    # user had to type. "And why?" is a one-word question and a complex one. It still sets
    # the answer length; how many passages to use is decided after searching (below).
    complexity = measure_complexity(search_query)
    tier_params = TIER_PARAMS[complexity.tier]
    resolved_max_tokens = max_tokens if max_tokens is not None else tier_params["max_tokens"]

    # An explicit top_k (an admin override, or a test) is a fixed count. Otherwise
    # "adaptive" fetches a fixed pool and lets the scores decide, and "tiered" keeps the
    # earlier behaviour of guessing the count from the question's complexity.
    adaptive = top_k is None and settings.selection == "adaptive"
    if top_k is not None:
        pool = top_k
    elif adaptive:
        pool = settings.candidate_pool
    else:
        pool = tier_params["top_k"]

    def search(query: str) -> list[RetrievedChunk]:
        return retrieve_chunks(query, db, top_k=pool, project_id=project_id, include_general=include_general)

    if resolved.rewritten and settings.fusion == "rrf":
        # Both the rewrite and the user's own words are searched, and their rankings merged.
        # A rewrite is a guess about what the user meant: when it is right it carries the
        # subject the words lack, when it is wrong the words still find the passage. Fusion
        # keeps whatever both agree on at the top instead of betting on one of them.
        candidates = reciprocal_rank_fusion([search(search_query), search(question)], k=settings.rrf_k)[:pool]
        search_info = {
            "query": search_query, "rewritten": True, "reason": resolved.reason,
            "queries": [search_query, question], "fusion": "rrf",
        }
    else:
        candidates = search(search_query)
        # "fallback": the literal question is only tried when the rewrite finds nothing usable.
        if resolved.rewritten and (not candidates or _best(candidates) < MIN_SIMILARITY):
            literal = search(question)
            if literal and (not candidates or _best(literal) > _best(candidates)):
                candidates = literal
                search_query = question
                resolved = ResolvedQuery(question, False, "rewrite retrieved nothing; used the original")
        # Carried into the response so a wrong answer can be attributed to retrieval or to
        # generation. Without it, a follow-up that searched for the wrong thing is
        # indistinguishable from one where the documentation simply did not have the answer.
        search_info = {"query": search_query, "rewritten": resolved.rewritten, "reason": resolved.reason}

    evidence = Evidence(resolved, complexity, resolved_max_tokens, candidates, [], search_info)
    if not candidates or _best(candidates) < MIN_SIMILARITY:
        evidence.found = False
        evidence.retrieval_info = {"candidates": len(candidates), "selected": 0}
        return evidence

    if adaptive:
        selected = select_by_relative_score(
            candidates, settings.relative_cutoff, settings.min_chunks, settings.max_chunks
        )
    else:
        selected = candidates[:pool]
    evidence.retrieval_info = {
        "selection": "adaptive" if adaptive else ("fixed" if top_k is not None else "tiered"),
        "hybrid": settings.hybrid,
        "candidates": len(candidates),
        "best_score": round(_best(candidates), 4),
        "cutoff": round(settings.relative_cutoff * _best(candidates), 4) if adaptive else None,
        "selected": len(selected),
        "focus": None,
    }

    if focus_doc_ids and looks_like_followup(question):
        focus_hits = retrieve_chunks(
            search_query, db, top_k=len(selected), project_id=project_id,
            include_general=include_general, doc_ids=set(focus_doc_ids),
        )
        focused = _keep_focus(selected, focus_hits, len(selected))
        evidence.retrieval_info["focus"] = "kept" if focused is not selected else "released"
        selected = focused
    evidence.selected = selected
    return evidence


def _best(items: list[RetrievedChunk]) -> float:
    # Fused rankings are ordered by rank agreement, not by similarity, so the best
    # similarity is not necessarily first.
    return max(item.score for item in items)


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
    # top_k/max_tokens default to None so retrieval scores (and the question's complexity,
    # for the answer length) decide them; an explicit caller-supplied value always wins.
    recent_history = (history or [])[-HISTORY_TURNS:]
    evidence = gather_evidence(
        question, db, top_k=top_k, max_tokens=max_tokens, project_id=project_id,
        include_general=include_general, history=recent_history, focus_doc_ids=focus_doc_ids,
    )
    return compose_answer(question, evidence, recent_history)


def compose_answer(question: str, evidence: Evidence, history: History | None = None) -> dict:
    """The generation half of answer(): turns gathered evidence into the response dict."""
    recent_history = (history or [])[-HISTORY_TURNS:]
    complexity, search_info = evidence.complexity, evidence.search_info
    if not evidence.found:
        result = _not_found(complexity, search_info)
        result["retrieval"] = evidence.retrieval_info
        return result

    # History is in the answer prompt to resolve "he"/"it"/"that" - the same job it does for
    # retrieval above, so it is gated the same way. A question that already stands on its own
    # has nothing to resolve, and small models copy the shape of earlier answers onto it
    # instead of reading the documentation: one earlier "I don't have any information about
    # X." made Llama 3.2 1B/3B, Qwen2.5 3B and Phi-4-mini refuse a later question about X in
    # every run, with X's document retrieved first. Turns that found nothing arrive with an
    # empty answer (see src/api/conversations.py): the rewriter above still needs to know
    # they were asked, but an answer prompt has nothing to learn from a question with none.
    is_followup = looks_like_followup(question)
    prompt_history = [turn for turn in recent_history if turn[1]] if is_followup else []

    fitted, prompt, context_info = _fit_to_context(question, evidence.selected, evidence.max_tokens, prompt_history)
    generated = llm_adapter.generate(prompt, max_tokens=evidence.max_tokens)

    # Clearing MIN_SIMILARITY only means a chunk was close enough to be worth reading, not
    # that it holds the answer. When the model reads them and says so, this is a miss like
    # any other: listing those chunks as sources would claim evidence for an answer that was
    # never given.
    if is_refusal(generated):
        result = _not_found(complexity, search_info, context_info)
        result["retrieval"] = evidence.retrieval_info
        return result

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
        "retrieval": evidence.retrieval_info,
    }

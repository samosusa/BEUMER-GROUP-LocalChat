"""Turns a follow-up question into a standalone one, for retrieval only.

A conversational RAG turn has two consumers, and they need different things:

  retrieval   needs a SELF-CONTAINED question. "What are his hobbies?" embeds to a vector
              that means nothing in particular.

  generation  needs the DIALOGUE, so pronouns resolve and the reply reads as a reply.

src/rag_service.py already gives generation what it needs, by putting the recent turns in
the prompt. This module exists for the other half, which concatenating prior questions onto
the new one cannot do: an embedding of "Who is Samo Susa?\nWhat are his hobbies?" is a
single vector averaging two questions, so it lands between them and ranks documents about
neither especially well. The more prior turns are prefixed, the further it drifts. That is
why the concatenation fix reads as "practically nefunguje" - it is not too weak, it is
aimed at the wrong point.

Rewriting costs one extra LLM call, which on a CPU-only machine is seconds rather than
milliseconds. `looks_like_followup()` is a cheap gate so only questions that actually
depend on earlier turns pay for it; anything already standalone is passed straight through.

Every failure path falls back to the user's original question and records why in `reason`.
A silently mangled search query is indistinguishable from a bad retriever, and would send
whoever debugs it to entirely the wrong place.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from src import llm_adapter

# The rewrite is one short question. Past this, the model has stopped following the
# instruction and started answering instead.
REWRITE_MAX_TOKENS = 64
REWRITE_MAX_CHARS = 300


@dataclass(frozen=True)
class ResolvedQuery:
    """What retrieval should search for, and an honest account of how that was decided."""

    search_query: str
    rewritten: bool
    reason: str


# Openers that only make sense as a continuation of something already said. Danish is
# included because the app ships a Danish evaluation set (data/eval/rag_qa_pairs_da.json),
# and a Danish follow-up should not skip a gate an English one trips.
_FOLLOWUP_OPENERS = (
    "and", "but", "so", "then", "also", "what about", "how about", "ok and", "okay and",
    "og", "men", "så", "hvad med", "og hvad",
)

# A pronoun or demonstrative standing in for a noun the user never repeats.
_REFERRING_TERMS = (
    "it", "its", "that", "this", "they", "them", "those", "these", "the one", "the same",
    "he", "she", "his", "her", "there",
    "det", "den", "de", "dem", "dette", "disse",
)

# Words carrying no topic of their own. A question built almost entirely from these leaves
# an embedding model nothing to latch onto.
_STOPWORDS = frozenset(
    """a an the and or but so then also of to in on at for from by with about is are was
    were be been do does did can could should would will shall may might must i we you it
    its that this they them those these he she his her there what when where which who whom
    whose why how often much many long""".split()
)

_WORD_RE = re.compile(r"[\wÀ-ÿ']+", re.UNICODE)
_LABEL_RE = re.compile(
    r"^\s*(standalone\s+question|rewritten\s+question|question|query|answer)\s*[:\-]\s*",
    re.IGNORECASE,
)


def _words(text: str) -> list[str]:
    return [word.lower() for word in _WORD_RE.findall(text)]


def looks_like_followup(question: str) -> bool:
    """True when the question cannot be understood without the turns before it.

    Deliberately over-eager rather than clever. A false positive costs one short LLM call
    and a rewrite that returns roughly the original; a false negative sends a meaningless
    vector to the retriever and yields a confidently wrong answer. The asymmetry is the
    whole design, and it is why the bar for "looks like a follow-up" is set low.
    """
    stripped = question.strip().lower()
    if not stripped:
        return False

    if any(stripped == opener or stripped.startswith(opener + " ") for opener in _FOLLOWUP_OPENERS):
        return True

    words = _words(stripped)
    if not words:
        return False

    # A referring expression with no noun of its own to anchor it: "what are his hobbies"
    # has one content word and a "his" that only the previous turn explains.
    content = [word for word in words if word not in _STOPWORDS]
    if any(term in words for term in _REFERRING_TERMS if " " not in term) and len(content) <= 3:
        return True
    if any(term in stripped for term in _REFERRING_TERMS if " " in term):
        return True

    # Elliptical: almost nothing but function words. "How often?", "Why?", "And the motor?"
    return len(content) <= 1


def _render_for_rewrite(history: list[tuple[str, str]]) -> str:
    """The dialogue as the rewriter sees it. Separate from rag_service's own history
    formatting on purpose: that block is tuned for answering, this one for one narrow
    extraction task, and tying them together would mean every change to the answer prompt
    silently re-tunes the rewriter too."""
    return "\n".join(
        f"User: {' '.join(asked.split())}\nAssistant: {' '.join(answered.split())}"
        for asked, answered in history
    )


def _rewrite_prompt(question: str, history: list[tuple[str, str]]) -> str:
    return (
        "Rewrite the user's latest question so that it can be understood on its own, "
        "without the conversation. Replace pronouns and references with what they refer "
        "to. Keep the user's own wording wherever you can. Do not answer it. "
        "Reply with the rewritten question on one line and nothing else.\n\n"
        f"Conversation:\n{_render_for_rewrite(history)}\n\n"
        f"Latest question: {question}\nStandalone question:"
    )


def _validate_rewrite(candidate: str, question: str) -> str | None:
    """The usable rewrite, or None so the caller falls back to the original.

    A rewrite exists to ADD the context the user left out, so one that comes back shorter
    than what they typed has dropped something instead of adding it. That single invariant
    catches most of what small models do wrong here: answering the question, echoing the
    instructions back, or returning nothing at all.
    """
    first_line = next((line for line in candidate.splitlines() if line.strip()), "")
    cleaned = _LABEL_RE.sub("", first_line).strip().strip('"').strip("'").strip()
    if not cleaned:
        return None
    if len(cleaned) > REWRITE_MAX_CHARS:
        return None
    if len(cleaned) < len(question.strip()):
        return None
    if not _words(cleaned):
        return None
    return cleaned


def resolve_search_query(
    question: str,
    history: list[tuple[str, str]],
    generate=None,
) -> ResolvedQuery:
    """Decide what the retriever should search for.

    `generate` is injectable so this decision can be tested without loading a GGUF.
    """
    generate = generate or llm_adapter.generate
    question = question.strip()

    usable = [(asked, answered) for asked, answered in (history or []) if asked and asked.strip()]
    if not usable:
        return ResolvedQuery(question, False, "no history")
    if not looks_like_followup(question):
        return ResolvedQuery(question, False, "question already stands alone")

    try:
        raw = generate(_rewrite_prompt(question, usable), max_tokens=REWRITE_MAX_TOKENS)
    except Exception as error:  # a failed rewrite must never fail the user's question
        return ResolvedQuery(question, False, f"rewrite failed: {type(error).__name__}")

    cleaned = _validate_rewrite(raw or "", question)
    if cleaned is None:
        return ResolvedQuery(question, False, "rewrite rejected as unusable")
    return ResolvedQuery(cleaned, True, "rewritten from conversation")

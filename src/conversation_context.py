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

from src import llm_adapter, rag_config

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

# Words that make a sentence ask something by itself. A short fragment with none of them -
# "Maximum load?", "Error codes?" - can only be a continuation of what was just said,
# however many content words it has. Danish included for the same reason as above.
_QUESTION_WORDS = frozenset(
    """who what when where why how which whose whom is are was were do does did can could
    should would will has have had tell list describe show give explain find
    hvem hvad hvor hvornår hvorfor hvordan hvilken hvilket hvilke er var kan""".split()
)
FRAGMENT_MAX_WORDS = 3

_WORD_RE = re.compile(r"[\wÀ-ÿ']+", re.UNICODE)
_LABEL_RE = re.compile(
    r"^\s*(standalone\s+question|rewritten\s+question|question|query|answer)\s*[:\-]\s*",
    re.IGNORECASE,
)


def _words(text: str) -> list[str]:
    return [word.lower() for word in _WORD_RE.findall(text)]


def _is_fragment(words: list[str]) -> bool:
    return len(words) <= FRAGMENT_MAX_WORDS and not any(word in _QUESTION_WORDS for word in words)


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

    # A bare fragment that asks nothing on its own: "Maximum load?", "Any error codes?"
    if _is_fragment(words):
        return True

    # Elliptical: almost nothing but function words. "How often?", "Why?", "And the motor?"
    return len(content) <= 1


# ---------------------------------------------------------------------------------------
# Compact history
#
# A small rewriter given whole earlier turns tends to copy their details into the rewrite,
# or to answer instead of rewriting. What it needs from an earlier question is only what
# that question was about - "What is the max throughput of the CrisBelt?" is about the
# CrisBelt - and from an earlier answer only its opening statement.
# ---------------------------------------------------------------------------------------

# Imperatives that open a question ("Name three...", "List the...") and are capitalised
# only because they start the sentence.
_LEADING_VERBS = frozenset(
    """name list describe give show tell explain find compare summarize summarise define
    please""".split()
)
# Words that carry the question's grammar or intent, not its subject.
_GENERIC_WORDS = frozenset(
    """say says said mean means need needs required require requires use used using happen
    happens work works done make makes get gets know kind type types way ways main long often
    much many number exactly least doing going""".split()
)
_SUBJECT_TOKEN_RE = re.compile(r"[\w®/-]+", re.UNICODE)
SUBJECT_MAX_WORDS = 6
FIRST_SENTENCE_MAX_CHARS = 240
_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")


def _is_named(token: str) -> bool:
    """A proper noun, product name or code: CrisBelt, Samo, MSC800, OPNL_B01, HBS."""
    lower = token.lower()
    if lower in _STOPWORDS or lower in _QUESTION_WORDS or lower in _LEADING_VERBS:
        return False
    if any(char.isdigit() for char in token) and any(char.isalpha() for char in token):
        return True
    return token[0].isupper() or any(char.isupper() for char in token[1:])


def extract_subject(question: str) -> str:
    """The entity an earlier question was about, for the rewriter's view of the history.

    Named things first: runs of capitalised words or codes ("Samo Susa", "CrisBelt",
    "MSC800"). A question without one ("What does the maintenance program say about
    conveyor belts?") keeps its content words instead, which is as close to a subject as a
    rule can get without a model call. Falls back to the question itself rather than
    returning nothing, because an empty subject would lose the turn altogether."""
    tokens = _SUBJECT_TOKEN_RE.findall(question)
    groups: list[str] = []
    current: list[str] = []
    for token in [*tokens, ""]:
        if token and _is_named(token):
            current.append(token)
            continue
        if current and " ".join(current) not in groups:
            groups.append(" ".join(current))
        current = []
    if groups:
        return ", ".join(groups)

    content = [
        token for token in tokens
        if token.lower() not in _STOPWORDS
        and token.lower() not in _QUESTION_WORDS
        and token.lower() not in _GENERIC_WORDS
        and token.lower() not in _LEADING_VERBS
    ]
    return " ".join(content[:SUBJECT_MAX_WORDS]) or " ".join(question.split())


def first_sentence(text: str) -> str:
    """The opening statement of an earlier answer: its first line, then its first sentence,
    capped in length. The answer's headline is what a follow-up refers back to; the detail
    after it is what crowds the prompt."""
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    if not lines:
        return ""
    sentence = _SENTENCE_END_RE.split(lines[0], maxsplit=1)[0].strip()
    if len(sentence) > FIRST_SENTENCE_MAX_CHARS:
        sentence = sentence[: FIRST_SENTENCE_MAX_CHARS - 1].rstrip() + "…"
    return sentence


def _render_for_rewrite(history: list[tuple[str, str]], mode: str | None = None) -> str:
    """The dialogue as the rewriter sees it. Separate from rag_service's own history
    formatting on purpose: that block is tuned for answering, this one for one narrow
    extraction task, and tying them together would mean every change to the answer prompt
    silently re-tunes the rewriter too.

    "compact" (the default, see src/rag_config.py) reduces each earlier question to its
    subject and each earlier answer to its first sentence; "full" passes both verbatim."""
    mode = mode or rag_config.get().history_mode
    # A turn that found nothing has an empty answer: what was asked still says who or what
    # the conversation is about now, even though nothing came back.
    if mode == "compact":
        return "\n".join(
            f"User asked about: {extract_subject(asked)}"
            + (f"\nAssistant: {first_sentence(answered)}" if answered.strip() else "")
            for asked, answered in history
        )
    return "\n".join(
        f"User: {' '.join(asked.split())}"
        + (f"\nAssistant: {' '.join(answered.split())}" if answered.strip() else "")
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


def _content_words(text: str) -> set[str]:
    return {word.removesuffix("'s") for word in _words(text) if word not in _STOPWORDS}


def _adds_context(rewrite: str, question: str, history: list[tuple[str, str]]) -> bool:
    """Whether the rewrite carries in something from the conversation that the question
    left out - the whole point of a rewrite, and something _validate_rewrite cannot check
    without the conversation. Small models often pass the length check by echoing the
    question back unchanged, which would otherwise be recorded and searched as a rewrite."""
    from_history = set().union(*(_content_words(f"{asked} {answered}") for asked, answered in history))
    return bool(_content_words(rewrite) & (from_history - _content_words(question)))


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
    if not _adds_context(cleaned, question, usable):
        return ResolvedQuery(question, False, "rewrite added nothing from the conversation")
    return ResolvedQuery(cleaned, True, "rewritten from conversation")

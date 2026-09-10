"""Heuristic difficulty scoring for incoming questions, used to route retrieval depth
and generation budget per-query instead of the single fixed TOP_K/max_tokens pair.

Deliberately not model-based: this runs before retrieval, has to stay sub-millisecond,
and must work fully offline like the rest of the app. Swapping the active GGUF model
per-query is not in scope here - LLMAdapter.set_active() is a blocking unload+reload
that takes seconds (see src/llm_adapter.py), so routing operates on retrieval/generation
parameters against whichever model is already loaded, not on model choice itself.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_ANALYTICAL_TERMS = (
    "why", "compare", "comparison", "difference between", "explain", "analyze",
    "analysis", "relationship between", "pros and cons", "trade-off", "tradeoff",
    "recommend", "root cause", "best way", "advantages and disadvantages",
)
_PROCEDURAL_TERMS = (
    "how do i", "how do we", "how to", "steps to", "steps for", "procedure for",
    "procedure to", "process for",
)
_CONJUNCTIONS = (" and ", " or ", " vs ", " versus ")

_WORD_RE = re.compile(r"[a-zA-Z0-9']+")

TIERS = ("simple", "moderate", "complex")

# top_k / max_tokens applied when the caller doesn't explicitly override either one.
# "moderate" matches the app's previous fixed defaults (TOP_K=5, max_tokens=512).
TIER_PARAMS: dict[str, dict[str, int]] = {
    "simple": {"top_k": 3, "max_tokens": 256},
    "moderate": {"top_k": 5, "max_tokens": 512},
    "complex": {"top_k": 8, "max_tokens": 768},
}


@dataclass(frozen=True)
class QueryComplexity:
    score: float  # 0.0 (single-fact lookup) .. 1.0 (multi-part reasoning)
    tier: str  # one of TIERS
    word_count: int
    question_count: int
    signals: tuple[str, ...]  # which heuristics fired; for logging/debugging


_SENTENCE_SPLIT_RE = re.compile(r"[.!?]+(?:\s+|$)")
_VOWEL_GROUP_RE = re.compile(r"[aeiouyAEIOUY]+")

DOCUMENT_TIERS = ("simple", "moderate", "complex")


def _count_syllables(word: str) -> int:
    word = word.lower()
    count = len(_VOWEL_GROUP_RE.findall(word))
    if word.endswith("e") and count > 1:
        count -= 1
    return max(count, 1)


@dataclass(frozen=True)
class DocumentComplexity:
    score: float  # approximate Flesch-Kincaid grade level (clamped to >= 0)
    tier: str  # one of DOCUMENT_TIERS
    word_count: int
    sentence_count: int
    avg_sentence_length: float
    avg_syllables_per_word: float


def measure_document_complexity(text: str) -> DocumentComplexity:
    """Flesch-Kincaid grade level over the document's full extracted text: standard,
    explainable, and - like measure_complexity() above - cheap enough to run at ingest
    time with no model call and no external dependency. Syllable counts use a
    vowel-group heuristic (not a dictionary lookup), so treat the score as a rough
    signal for routing/display, not a precise readability measurement."""
    words = _WORD_RE.findall(text)
    word_count = len(words)
    if word_count == 0:
        return DocumentComplexity(
            score=0.0, tier="simple", word_count=0, sentence_count=0,
            avg_sentence_length=0.0, avg_syllables_per_word=0.0,
        )

    sentence_count = max(len([s for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]), 1)
    avg_sentence_length = word_count / sentence_count
    avg_syllables_per_word = sum(_count_syllables(word) for word in words) / word_count

    grade = 0.39 * avg_sentence_length + 11.8 * avg_syllables_per_word - 15.59
    score = round(max(grade, 0.0), 2)

    if score < 9:
        tier = "simple"
    elif score < 13:
        tier = "moderate"
    else:
        tier = "complex"

    return DocumentComplexity(
        score=score,
        tier=tier,
        word_count=word_count,
        sentence_count=sentence_count,
        avg_sentence_length=round(avg_sentence_length, 2),
        avg_syllables_per_word=round(avg_syllables_per_word, 2),
    )


def measure_complexity(question: str) -> QueryComplexity:
    text = question.strip()
    lower = f" {text.lower()} "
    word_count = len(_WORD_RE.findall(text))
    question_count = max(text.count("?"), 1) if text else 0

    signals: list[str] = []
    score = 0.0

    if word_count > 25:
        score += 0.3
        signals.append("long_question")
    elif word_count > 12:
        score += 0.15
        signals.append("medium_question")

    if question_count > 1:
        score += 0.2 * (question_count - 1)
        signals.append("multi_part")

    if any(conj in lower for conj in _CONJUNCTIONS):
        score += 0.15
        signals.append("conjunction")

    if any(term in lower for term in _ANALYTICAL_TERMS):
        score += 0.35
        signals.append("analytical")

    if any(term in lower for term in _PROCEDURAL_TERMS):
        score += 0.2
        signals.append("procedural")

    score = min(round(score, 2), 1.0)

    if score >= 0.5:
        tier = "complex"
    elif score >= 0.2:
        tier = "moderate"
    else:
        tier = "simple"

    return QueryComplexity(
        score=score,
        tier=tier,
        word_count=word_count,
        question_count=question_count,
        signals=tuple(signals),
    )

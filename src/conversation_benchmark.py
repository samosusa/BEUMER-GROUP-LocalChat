"""Conversation benchmark: does a retrieval or history change make multi-turn answers better
or worse?

Single-question benchmarks (src/rag_eval.py) cannot see the changes this measures. Query
rewriting, compact history, fusing the rewrite with the user's own words and the focus
document only do anything on the second turn of a conversation and later. So this module
replays scripted conversations (data/eval/conversations/) turn by turn, building history and
the focus document exactly as src/api/conversations.py does. It runs each conversation once
per settings variant (src/rag_config.py), with the same corpus, model and questions, so the
only difference between two rows of the summary is the setting being compared.

It also runs a retrieval-only pass over the single-question set (data/eval/demo_qa_pairs.json),
which is where hybrid search and the relative-score chunk selection show up on their own.

Each turn is scored on what retrieval handed the model, which is mechanical and needs no
judge:

  source_hit    a selected passage comes from the document the answer is in
  top1_hit      the first selected passage does
  evidence_hit  the selected passages contain the answer's key phrases (`keywords`), i.e.
                the right passage, not just the right document
  precision     share of the selected passages that come from the expected document; a
                lower value means the model is reading more off-topic text
  selected      how many passages the model was given

With `answers=True` each turn is also generated and graded by the active LLM against a
reference answer (the same same-model-judge caveat as src/rag_eval.py applies). Questions
whose answer is not in the corpus are scored on whether the system said so.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from statistics import mean
from typing import Any, Callable

from sqlalchemy.orm import Session

from src import rag_config, rag_service
from src.rag_config import RagSettings

ROOT = Path(__file__).resolve().parent.parent
CONVERSATION_DATASET = ROOT / "data" / "eval" / "conversations" / "demo_conversations.json"
QA_DATASET = ROOT / "data" / "eval" / "demo_qa_pairs.json"

# Each variant is a full RagSettings, so a variant means the same thing regardless of any
# LOCALCHAT_* environment variable the benchmark process happens to inherit.
VARIANTS: dict[str, dict[str, Any]] = {
    # The pipeline as it was before these changes.
    "baseline": {"history_mode": "full", "fusion": "fallback", "hybrid": False, "selection": "tiered"},
    # The current defaults: compact history, RRF of rewrite + original, hybrid, adaptive.
    "improved": {},
    # The improved pipeline with exactly one change undone - what each change contributes.
    "no-compact-history": {"history_mode": "full"},
    "no-rrf": {"fusion": "fallback"},
    "no-hybrid": {"hybrid": False},
    "tiered-selection": {"selection": "tiered"},
}

Judge = Callable[[str, str, str | None], tuple[str | None, str | None]]


def settings_for(variant: str) -> dict[str, Any]:
    return asdict(RagSettings(**VARIANTS[variant]))


def load_conversations(path: Path | None = None) -> list[dict[str, Any]]:
    return json.loads((path or CONVERSATION_DATASET).read_text(encoding="utf-8"))


def load_questions(path: Path | None = None) -> list[dict[str, Any]]:
    return json.loads((path or QA_DATASET).read_text(encoding="utf-8"))


def _normalize(text: str) -> str:
    return " ".join((text or "").lower().split())


def _matches(title: str, hints: list[str]) -> bool:
    # Same rule as rag_eval._retrieval_hit: the ingest title contains the file stem.
    title = (title or "").lower()
    return any(hint.lower() in title for hint in hints)


def score_selection(selected: list[Any], expected_sources: list[str], keywords: list[str]) -> dict[str, Any]:
    """Scores the passages retrieval selected against the document and key phrases the
    answer is known to be in."""
    if not selected:
        return {"source_hit": False, "top1_hit": False, "evidence_hit": False, "precision": 0.0}
    titles = [item.document.title for item in selected]
    on_target = [_matches(title, expected_sources) for title in titles]
    text = _normalize(" ".join(item.chunk.text for item in selected))
    return {
        "source_hit": any(on_target),
        "top1_hit": on_target[0],
        "evidence_hit": all(_normalize(keyword) in text for keyword in keywords),
        "precision": sum(on_target) / len(on_target),
    }


@dataclass
class TurnScore:
    variant: str
    conversation: str
    turn: int
    kind: str
    question: str
    expected_source: str | None
    search_query: str
    rewritten: bool
    found: bool
    candidates: int
    selected: int
    selected_sources: list[str] = field(default_factory=list)
    source_hit: bool | None = None
    top1_hit: bool | None = None
    evidence_hit: bool | None = None
    precision: float | None = None
    # Questions the corpus cannot answer: did the system say so?
    refused: bool | None = None
    answer: str | None = None
    judge_verdict: str | None = None
    latency_s: float = 0.0


def run_conversation(
    db: Session,
    conversation: dict[str, Any],
    variant: str,
    answers: bool = False,
    judge: Judge | None = None,
) -> list[TurnScore]:
    """Replays one conversation. History and focus are built the way the API builds them:
    each turn's searched query (the rewrite, when there was one) and its answer - empty when
    the turn found nothing - and the previous answer's top source as the focus document.

    Without `answers`, the dataset's reference answer stands in for the generated one, so
    every variant sees the same earlier answers and differs only in retrieval."""
    history: list[tuple[str, str]] = []
    focus: list[int] = []
    scores = []
    for number, turn in enumerate(conversation["turns"], start=1):
        answerable = turn["expected_source"] is not None
        started = time.perf_counter()
        evidence = rag_service.gather_evidence(turn["question"], db, history=history, focus_doc_ids=focus)
        generated = None
        if answers:
            result = rag_service.compose_answer(turn["question"], evidence, history)
            found = not result["not_found"]
            generated = result["answer"] if found else None
        else:
            # A correct system refuses an unanswerable turn, so its stand-in answer is empty.
            found = evidence.found and answerable
        elapsed = time.perf_counter() - started

        score = TurnScore(
            variant=variant,
            conversation=conversation["id"],
            turn=number,
            kind=turn["kind"],
            question=turn["question"],
            expected_source=turn["expected_source"],
            search_query=evidence.search_info["query"],
            rewritten=bool(evidence.search_info.get("rewritten")),
            found=found,
            candidates=len(evidence.candidates),
            selected=len(evidence.selected),
            selected_sources=[item.document.title for item in evidence.selected],
            answer=generated,
            latency_s=round(elapsed, 3),
        )
        if answerable:
            score.__dict__.update(score_selection(evidence.selected, [turn["expected_source"]], turn["keywords"]))
            if answers and judge is not None:
                score.judge_verdict, _ = judge(evidence.search_info["query"], turn["reference_answer"], generated)
        else:
            score.refused = not found if answers else not evidence.found
        scores.append(score)

        reply = (generated if answers else turn["reference_answer"]) if found else ""
        history.append((evidence.search_info["query"], reply or ""))
        focus = [evidence.selected[0].document.id] if found and evidence.selected else []
    return scores


def run_conversations(
    db: Session,
    conversations: list[dict[str, Any]],
    variant: str,
    answers: bool = False,
    judge: Judge | None = None,
    on_conversation: Callable[[str], None] | None = None,
) -> list[TurnScore]:
    scores: list[TurnScore] = []
    with rag_config.override(**settings_for(variant)):
        for conversation in conversations:
            scores.extend(run_conversation(db, conversation, variant, answers=answers, judge=judge))
            if on_conversation:
                on_conversation(conversation["id"])
    return scores


def judge_turns(scores: list[TurnScore], conversations: list[dict[str, Any]], judge: Judge) -> None:
    """Grades already-generated answers against the reference answers, in place. Separate
    from run_conversation so the judge can be another model loaded after generation."""
    turns = {(c["id"], n): turn for c in conversations for n, turn in enumerate(c["turns"], start=1)}
    for score in scores:
        turn = turns[(score.conversation, score.turn)]
        if turn["expected_source"] is not None:
            score.judge_verdict, _ = judge(score.search_query, turn["reference_answer"], score.answer)


@dataclass
class QuestionScore:
    variant: str
    id: str
    difficulty: str
    type: str
    question: str
    expected_sources: list[str]
    answerable: bool
    found: bool
    best_score: float | None
    candidates: int
    selected: int
    selected_sources: list[str] = field(default_factory=list)
    source_hit: bool | None = None
    top1_hit: bool | None = None
    evidence_hit: bool | None = None
    precision: float | None = None


def run_questions(db: Session, dataset: list[dict[str, Any]], variant: str) -> list[QuestionScore]:
    """Retrieval only - no history, no generation - over the single-question set. Measures
    hybrid search and the chunk-count rule without the cost of an LLM call per question."""
    scores = []
    with rag_config.override(**settings_for(variant)):
        for group in dataset:
            for item in group["questions"]:
                evidence = rag_service.gather_evidence(item["question"], db)
                answerable = item.get("answerable", True)
                expected = [group["title_hint"], *item.get("also_title_hints", [])]
                score = QuestionScore(
                    variant=variant,
                    id=item.get("id", item["question"]),
                    difficulty=item["difficulty"],
                    type=item.get("type", "fact"),
                    question=item["question"],
                    expected_sources=expected,
                    answerable=answerable,
                    found=evidence.found,
                    best_score=round(max((c.score for c in evidence.candidates), default=0.0), 4) or None,
                    candidates=len(evidence.candidates),
                    selected=len(evidence.selected),
                    selected_sources=[c.document.title for c in evidence.selected],
                )
                if answerable:
                    score.__dict__.update(score_selection(evidence.selected, expected, item.get("keywords", [])))
                scores.append(score)
    return scores


def _rate(values: list[Any]) -> float | None:
    values = [value for value in values if value is not None]
    return round(sum(1 for value in values if value) / len(values), 4) if values else None


def _avg(values: list[Any]) -> float | None:
    values = [value for value in values if value is not None]
    return round(mean(values), 3) if values else None


def _bucket(rows: list[Any]) -> dict[str, Any]:
    answerable = [row for row in rows if getattr(row, "refused", None) is None and getattr(row, "answerable", True)]
    unanswerable = [row for row in rows if row not in answerable]
    bucket = {
        "n": len(rows),
        "source_hit": _rate([row.source_hit for row in answerable]),
        "top1_hit": _rate([row.top1_hit for row in answerable]),
        "evidence_hit": _rate([row.evidence_hit for row in answerable]),
        "precision": _avg([row.precision for row in answerable]),
        "selected": _avg([row.selected for row in answerable]),
    }
    if any(isinstance(row, TurnScore) for row in rows):
        bucket["rewritten"] = _rate([row.rewritten for row in rows])
        verdicts = [row.judge_verdict for row in answerable if row.judge_verdict]
        if verdicts:
            bucket["judge_correct"] = round(verdicts.count("correct") / len(verdicts), 4)
            bucket["judge_partial"] = round(verdicts.count("partial") / len(verdicts), 4)
        if unanswerable:
            bucket["refused_unanswerable"] = _rate([row.refused for row in unanswerable])
    if unanswerable and not any(isinstance(row, TurnScore) for row in rows):
        bucket["unanswerable_below_threshold"] = _rate([not row.found for row in unanswerable])
    return bucket


def summarize(rows: list[Any], group_by: tuple[str, ...] = ("kind",)) -> dict[str, Any]:
    summary: dict[str, Any] = {"overall": _bucket(rows)}
    for attribute in group_by:
        values = sorted({getattr(row, attribute) for row in rows})
        summary[f"by_{attribute}"] = {
            value: _bucket([row for row in rows if getattr(row, attribute) == value]) for value in values
        }
    return summary

"""Runs the labeled question set in data/eval/rag_qa_pairs.json end to end - real retrieval
plus real generation, via src/rag_service.answer() - against whichever project's documents
are currently ingested. Same job-row-updated-as-it-goes shape as src/benchmark.py and
src/reindex.py.

Each question is scored two different ways, and neither is a substitute for reading the
actual vs. expected answer in the results table yourself:

  retrieval_hit  Objective and mechanical: did the source document the question was written
                 against actually show up in the answer's citations? This says nothing about
                 whether the right passage inside that document was used, only that the
                 right document was found at all.

  judge_verdict  The currently active LLM is asked to compare the generated answer against
                 the reference answer. This is the same model that may have generated the
                 answer being judged, which is a real, known bias in any same-model grading
                 setup - a good verdict here is not independent confirmation, just a second,
                 cheap signal alongside the human-readable transcript.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from src import llm_adapter
from src.models.rag_eval_job import RagEvalJob
from src.models.rag_eval_result import RagEvalResult
from src.rag_service import answer

ROOT = Path(__file__).resolve().parent.parent
QA_DATASET_DIR = ROOT / "data" / "eval"
# The dataset this app ships with; also the fallback when a caller doesn't ask for a
# specific one, so existing callers (and the tests written before multi-dataset support)
# keep working unchanged.
DEFAULT_DATASET_ID = "rag_qa_pairs"

JUDGE_VERDICTS = ("correct", "partial", "incorrect")
_VERDICT_RE = re.compile(r"\b(correct|partial|incorrect)\b", re.IGNORECASE)

JUDGE_PROMPT = (
    "You are grading whether a generated answer captures the same key facts as a reference "
    "answer to a question. Minor wording differences do not matter; missing or contradicted "
    "facts do.\n\n"
    "Question: {question}\n"
    "Reference answer: {expected_answer}\n"
    "Generated answer: {actual_answer}\n\n"
    "Respond with exactly one word: CORRECT, PARTIAL, or INCORRECT.\n"
    # generate() is a raw completion, not a chat turn: without a cue to complete, small models
    # open with "Note: the reference answer..." and the 8-token budget ends before any verdict.
    "Verdict:"
)

# A dataset id becomes part of a filesystem path below - restricted to a bare filename stem
# so a caller can never walk it outside data/eval/ (e.g. "../../etc/passwd").
_DATASET_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class DatasetNotFoundError(ValueError):
    pass


def list_dataset_ids(directory: Path | None = None) -> list[str]:
    """Every *.json file directly under data/eval/ is a selectable dataset - drop a new one
    in to add a choice, no code change needed."""
    return sorted(path.stem for path in (directory or QA_DATASET_DIR).glob("*.json"))


def _dataset_path(dataset_id: str, directory: Path | None = None) -> Path:
    if not _DATASET_ID_PATTERN.fullmatch(dataset_id):
        raise DatasetNotFoundError(f"Invalid dataset id {dataset_id!r}")
    path = (directory or QA_DATASET_DIR) / f"{dataset_id}.json"
    if not path.is_file():
        raise DatasetNotFoundError(f"No dataset named {dataset_id!r} in {directory or QA_DATASET_DIR}")
    return path


def load_qa_dataset(dataset_id: str = DEFAULT_DATASET_ID, directory: Path | None = None) -> list[dict[str, Any]]:
    return json.loads(_dataset_path(dataset_id, directory).read_text(encoding="utf-8"))


def describe_datasets(directory: Path | None = None) -> list[dict[str, Any]]:
    """One summary per dataset file, for GET /rag-eval/datasets - document/question counts
    without a caller having to fetch and count each file's full contents itself."""
    summaries = []
    for dataset_id in list_dataset_ids(directory):
        dataset = load_qa_dataset(dataset_id, directory)
        summaries.append(
            {
                "id": dataset_id,
                "documents": [
                    {
                        "source": doc["source"],
                        "title_hint": doc["title_hint"],
                        "question_count": len(doc["questions"]),
                    }
                    for doc in dataset
                ],
                "total_questions": sum(len(doc["questions"]) for doc in dataset),
            }
        )
    return summaries


@dataclass
class RagEvalRow:
    source: str
    difficulty: str
    question: str
    expected_answer: str
    actual_answer: str | None = None
    not_found: bool = False
    retrieval_hit: bool = False
    judge_verdict: str | None = None
    judge_detail: str | None = None
    complexity_tier: str | None = None
    complexity_score: float | None = None
    latency_s: float | None = None
    citations: list[dict[str, Any]] = field(default_factory=list)


def _retrieval_hit(title_hint: str, citations: list[dict[str, Any]]) -> bool:
    needle = title_hint.lower()
    return any(needle in (citation.get("title") or "").lower() for citation in citations)


def judge(question: str, expected_answer: str, actual_answer: str | None) -> tuple[str | None, str | None]:
    """Returns (verdict, raw_output). No verdict at all - not "incorrect" - when there was no
    answer to grade in the first place, so a not_found row is never counted as a wrong answer
    by the judge; the not_found flag itself already reports that outcome."""
    if actual_answer is None:
        return None, None
    prompt = JUDGE_PROMPT.format(
        question=question, expected_answer=expected_answer, actual_answer=actual_answer
    )
    try:
        raw = llm_adapter.generate(prompt, max_tokens=8).strip()
    except Exception as error:
        return "error", str(error)
    # The first verdict word, matched as a whole word: a substring test would read
    # "INCORRECT" as "correct", since that is the first verdict checked.
    match = _VERDICT_RE.search(raw)
    return (match.group(1).lower(), raw) if match else ("error", raw)


def run_one(db: Session, doc: dict[str, Any], item: dict[str, Any], project_id: int | None) -> RagEvalRow:
    row = RagEvalRow(
        source=doc["source"],
        difficulty=item["difficulty"],
        question=item["question"],
        expected_answer=item["expected_answer"],
    )
    t0 = time.perf_counter()
    result = answer(item["question"], db, project_id=project_id)
    row.latency_s = time.perf_counter() - t0

    row.actual_answer = result["answer"]
    row.not_found = result["not_found"]
    row.citations = result["citations"]
    row.complexity_tier = result["complexity"]["tier"]
    row.complexity_score = result["complexity"]["score"]
    if item.get("answerable", True):
        row.retrieval_hit = _retrieval_hit(doc["title_hint"], result["citations"])
    else:
        # The answer is not in the corpus (data/eval/demo_qa_pairs.json marks these): the
        # right outcome is saying so, and citing any document for it would be a miss.
        row.retrieval_hit = result["not_found"]
    row.judge_verdict, row.judge_detail = judge(
        item["question"], item["expected_answer"], row.actual_answer
    )
    return row


def summarize_results(rows: list[RagEvalResult]) -> dict[str, Any]:
    def _bucket(subset: list[RagEvalResult]) -> dict[str, Any]:
        total = len(subset)
        hits = sum(1 for row in subset if row.retrieval_hit)
        judge_counts = {verdict: 0 for verdict in (*JUDGE_VERDICTS, "error")}
        for row in subset:
            if row.judge_verdict is not None:
                judge_counts[row.judge_verdict] = judge_counts.get(row.judge_verdict, 0) + 1
        return {
            "total": total,
            "retrieval_hit_rate": (hits / total) if total else None,
            "judge_counts": judge_counts,
        }

    by_difficulty = {
        difficulty: _bucket([row for row in rows if row.difficulty == difficulty])
        for difficulty in sorted({row.difficulty for row in rows})
    }
    return {**_bucket(rows), "by_difficulty": by_difficulty}


def _get_job(db: Session, job_id: int) -> RagEvalJob:
    job = db.get(RagEvalJob, job_id)
    if job is None:
        raise ValueError(f"RAG eval job {job_id} not found")
    return job


def _mark_failed(db: Session, job_id: int, error: Exception) -> None:
    db.rollback()
    job = db.get(RagEvalJob, job_id)
    if job is not None:
        job.status = "failed"
        job.error = str(error)
        job.finished_at = datetime.utcnow()
        db.commit()


def _store_row(db: Session, job: RagEvalJob, row: RagEvalRow) -> None:
    db.add(
        RagEvalResult(
            rag_eval_job_id=job.id,
            source=row.source,
            difficulty=row.difficulty,
            question=row.question,
            expected_answer=row.expected_answer,
            actual_answer=row.actual_answer,
            not_found=row.not_found,
            retrieval_hit=row.retrieval_hit,
            judge_verdict=row.judge_verdict,
            judge_detail=row.judge_detail,
            complexity_tier=row.complexity_tier,
            complexity_score=row.complexity_score,
            latency_s=row.latency_s,
            citations=row.citations,
            run_at=datetime.utcnow(),
        )
    )
    job.completed_questions += 1
    db.commit()


def run_rag_eval_job(
    db: Session,
    job_id: int,
    project_id: int | None,
    dataset_id: str = DEFAULT_DATASET_ID,
    dataset_path: Path | None = None,
) -> None:
    job = _get_job(db, job_id)
    try:
        # dataset_path is a raw file override for tests only; production always resolves a
        # dataset_id against data/eval/ so a bad id fails loudly instead of reading an
        # arbitrary path a caller supplied.
        dataset = (
            json.loads(dataset_path.read_text(encoding="utf-8"))
            if dataset_path is not None
            else load_qa_dataset(dataset_id)
        )
        job.total_questions = sum(len(doc["questions"]) for doc in dataset)
        job.completed_questions = 0
        db.commit()

        for doc in dataset:
            for item in doc["questions"]:
                job.current_question = item["question"]
                db.commit()

                row = run_one(db, doc, item, project_id)
                _store_row(db, job, row)

        job.status = "completed"
        job.current_question = None
        job.finished_at = datetime.utcnow()
        db.commit()
    except Exception as error:
        _mark_failed(db, job_id, error)
        raise

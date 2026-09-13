import json
from datetime import datetime

import pytest

from src.models.rag_eval_result import RagEvalResult
from src.rag_eval import (
    DatasetNotFoundError,
    describe_datasets,
    judge,
    list_dataset_ids,
    load_qa_dataset,
    summarize_results,
)


def test_load_qa_dataset_has_45_questions_across_3_documents():
    dataset = load_qa_dataset()

    assert len(dataset) == 3
    total = sum(len(doc["questions"]) for doc in dataset)
    assert total == 45
    for doc in dataset:
        counts = {"easy": 0, "medium": 0, "hard": 0}
        for item in doc["questions"]:
            counts[item["difficulty"]] += 1
        assert counts == {"easy": 5, "medium": 5, "hard": 5}


def test_list_dataset_ids_finds_the_bundled_dataset():
    assert "rag_qa_pairs" in list_dataset_ids()


def test_load_qa_dataset_da_has_45_questions_across_the_same_3_documents():
    """Danish translation of the bundled dataset, run against the same English source PDFs -
    exercises cross-lingual retrieval and judging rather than a different set of documents."""
    dataset = load_qa_dataset("rag_qa_pairs_da")

    assert len(dataset) == 3
    assert {doc["source"] for doc in dataset} == {doc["source"] for doc in load_qa_dataset()}
    total = sum(len(doc["questions"]) for doc in dataset)
    assert total == 45
    for doc in dataset:
        counts = {"easy": 0, "medium": 0, "hard": 0}
        for item in doc["questions"]:
            counts[item["difficulty"]] += 1
        assert counts == {"easy": 5, "medium": 5, "hard": 5}


def test_list_dataset_ids_finds_the_danish_dataset():
    assert "rag_qa_pairs_da" in list_dataset_ids()


def test_load_qa_dataset_rejects_an_unknown_id():
    with pytest.raises(DatasetNotFoundError):
        load_qa_dataset("not-a-real-dataset")


def test_load_qa_dataset_rejects_path_traversal_attempts():
    with pytest.raises(DatasetNotFoundError):
        load_qa_dataset("../../etc/passwd")


def test_list_dataset_ids_and_load_qa_dataset_respect_a_custom_directory(tmp_path):
    (tmp_path / "custom_set.json").write_text(
        json.dumps(
            [{"source": "doc.pdf", "title_hint": "doc", "questions": [{"difficulty": "easy", "question": "q", "expected_answer": "a"}]}]
        ),
        encoding="utf-8",
    )

    assert list_dataset_ids(tmp_path) == ["custom_set"]
    dataset = load_qa_dataset("custom_set", tmp_path)
    assert dataset[0]["source"] == "doc.pdf"


def test_describe_datasets_summarizes_every_dataset_in_the_directory(tmp_path):
    (tmp_path / "one.json").write_text(
        json.dumps(
            [
                {
                    "source": "a.pdf",
                    "title_hint": "a",
                    "questions": [
                        {"difficulty": "easy", "question": "q1", "expected_answer": "a1"},
                        {"difficulty": "hard", "question": "q2", "expected_answer": "a2"},
                    ],
                }
            ]
        ),
        encoding="utf-8",
    )

    summaries = describe_datasets(tmp_path)

    assert len(summaries) == 1
    assert summaries[0]["id"] == "one"
    assert summaries[0]["total_questions"] == 2
    assert summaries[0]["documents"] == [{"source": "a.pdf", "title_hint": "a", "question_count": 2}]


def test_judge_returns_none_when_there_is_no_answer_to_grade():
    verdict, detail = judge("q", "expected", None)

    assert verdict is None
    assert detail is None


def test_judge_parses_the_models_verdict_word(monkeypatch):
    monkeypatch.setattr("src.rag_eval.llm_adapter.generate", lambda prompt, max_tokens: "  CORRECT\n")

    verdict, detail = judge("q", "expected", "actual")

    assert verdict == "correct"
    assert detail == "CORRECT"


def test_judge_falls_back_to_error_on_unparseable_output(monkeypatch):
    monkeypatch.setattr("src.rag_eval.llm_adapter.generate", lambda prompt, max_tokens: "I'm not sure")

    verdict, detail = judge("q", "expected", "actual")

    assert verdict == "error"
    assert detail == "I'm not sure"


def test_judge_reports_generation_failures_as_error(monkeypatch):
    def boom(prompt, max_tokens):
        raise RuntimeError("model not loaded")

    monkeypatch.setattr("src.rag_eval.llm_adapter.generate", boom)

    verdict, detail = judge("q", "expected", "actual")

    assert verdict == "error"
    assert "model not loaded" in detail


def _row(**overrides) -> RagEvalResult:
    defaults = dict(
        rag_eval_job_id=1,
        source="doc.pdf",
        difficulty="easy",
        question="q",
        expected_answer="a",
        actual_answer="a",
        not_found=False,
        retrieval_hit=True,
        judge_verdict="correct",
        judge_detail="CORRECT",
        complexity_tier="simple",
        complexity_score=0.1,
        latency_s=0.5,
        citations=[],
        run_at=datetime.utcnow(),
    )
    defaults.update(overrides)
    return RagEvalResult(**defaults)


def test_summarize_results_computes_overall_and_per_difficulty_stats():
    rows = [
        _row(difficulty="easy", retrieval_hit=True, judge_verdict="correct"),
        _row(difficulty="easy", retrieval_hit=False, judge_verdict="incorrect"),
        _row(difficulty="hard", retrieval_hit=True, judge_verdict="partial"),
    ]

    summary = summarize_results(rows)

    assert summary["total"] == 3
    assert summary["retrieval_hit_rate"] == pytest.approx(2 / 3)
    assert summary["judge_counts"]["correct"] == 1
    assert summary["judge_counts"]["incorrect"] == 1
    assert summary["judge_counts"]["partial"] == 1

    assert summary["by_difficulty"]["easy"]["total"] == 2
    assert summary["by_difficulty"]["easy"]["retrieval_hit_rate"] == pytest.approx(0.5)
    assert summary["by_difficulty"]["hard"]["total"] == 1
    assert summary["by_difficulty"]["hard"]["retrieval_hit_rate"] == 1.0


def test_summarize_results_handles_no_rows_without_dividing_by_zero():
    summary = summarize_results([])

    assert summary["total"] == 0
    assert summary["retrieval_hit_rate"] is None
    assert summary["by_difficulty"] == {}

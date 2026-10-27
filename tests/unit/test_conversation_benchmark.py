from collections import Counter
from types import SimpleNamespace

import pytest

from src import conversation_benchmark as bench
from src.rag_service import Evidence


def passage(title, text, doc_id=1, score=0.8):
    return SimpleNamespace(
        score=score,
        chunk=SimpleNamespace(text=text, section=None, page=None, chunk_index=0),
        document=SimpleNamespace(id=doc_id, title=title),
    )


def test_the_question_set_has_at_least_100_tagged_english_questions():
    questions = [q for group in bench.load_questions() for q in group["questions"]]
    assert len(questions) >= 100
    assert {q["difficulty"] for q in questions} == {"easy", "medium", "hard"}
    assert all(q["type"] and q["tags"] for q in questions)
    assert len({q["id"] for q in questions}) == len(questions)
    # Varying complexity: no difficulty level is a token presence.
    assert min(Counter(q["difficulty"] for q in questions).values()) >= 20


def test_every_conversation_turn_names_its_source_or_is_unanswerable():
    for conversation in bench.load_conversations():
        assert conversation["turns"][0]["kind"] == "standalone"
        for turn in conversation["turns"]:
            assert (turn["expected_source"] is None) == (turn["kind"] == "unanswerable")
            assert turn["expected_source"] is None or turn["keywords"]


def test_every_variant_is_a_valid_settings_combination():
    for name in bench.VARIANTS:
        bench.settings_for(name)
    assert bench.settings_for("baseline")["selection"] == "tiered"


def test_score_selection_separates_the_right_document_from_the_right_passage():
    selected = [
        passage("txt-long", "Forklifts must not exceed 8 km/h in warehouse aisles."),
        passage("md-sectioned", "Vehicles are limited to 15 km/h in the yard.", doc_id=2),
    ]
    assert bench.score_selection(selected, ["txt-long"], ["8 km/h"]) == {
        "source_hit": True, "top1_hit": True, "evidence_hit": True, "precision": 0.5,
    }
    wrong_passage = bench.score_selection(selected[:1], ["txt-long"], ["thirty minutes"])
    assert wrong_passage["source_hit"] and not wrong_passage["evidence_hit"]
    assert bench.score_selection([], ["txt-long"], ["8 km/h"])["source_hit"] is False


def test_keywords_match_across_line_breaks_and_case():
    selected = [passage("pdf-long", "Office staff assemble at the South\ncourtyard.")]
    assert bench.score_selection(selected, ["pdf-long"], ["south courtyard"])["evidence_hit"]


def test_a_replayed_conversation_carries_history_and_focus_like_the_api(monkeypatch):
    seen = []

    def fake_gather(question, db, history=None, focus_doc_ids=None):
        seen.append((question, list(history), list(focus_doc_ids)))
        found = question != "What is their phone number?"
        selected = [passage("pdf-long", "The senior manager on site acts as incident commander.", doc_id=7)]
        return Evidence(
            resolved=None, complexity=None, max_tokens=64,
            candidates=selected if found else [], selected=selected if found else [],
            search_info={"query": f"rewritten: {question}", "rewritten": bool(history)}, found=found,
        )

    monkeypatch.setattr(bench.rag_service, "gather_evidence", fake_gather)
    conversation = {
        "id": "incident",
        "turns": [
            {"kind": "standalone", "question": "Who is the incident commander?", "expected_source": "pdf-long",
             "keywords": ["incident commander"], "reference_answer": "The senior manager on site."},
            {"kind": "unanswerable", "question": "What is their phone number?", "expected_source": None,
             "keywords": [], "reference_answer": ""},
            {"kind": "followup", "question": "And after that?", "expected_source": "pdf-long",
             "keywords": ["incident commander"], "reference_answer": "x"},
        ],
    }

    scores = bench.run_conversation(object(), conversation, "improved")

    assert seen[1] == ("What is their phone number?",
                       [("rewritten: Who is the incident commander?", "The senior manager on site.")], [7])
    # The unanswerable turn found nothing: its question stays in history, its answer and focus do not.
    assert seen[2][1][-1] == ("rewritten: What is their phone number?", "")
    assert seen[2][2] == []
    assert scores[0].evidence_hit and scores[1].refused is True
    summary = bench.summarize(scores)
    assert summary["overall"]["refused_unanswerable"] == 1.0
    assert summary["by_kind"]["followup"]["n"] == 1


@pytest.mark.parametrize("variant", list(bench.VARIANTS))
def test_run_conversations_applies_and_restores_each_variant(monkeypatch, variant):
    from src import rag_config

    applied = []
    monkeypatch.setattr(bench, "run_conversation", lambda db, c, v, answers, judge: applied.append(rag_config.get()) or [])
    before = rag_config.get()
    bench.run_conversations(object(), [{"id": "x", "turns": []}], variant)
    assert applied[0].selection == bench.settings_for(variant)["selection"]
    assert rag_config.get() is before


def test_judge_turns_grades_answerable_turns_against_their_reference():
    conversations = [{"id": "c", "turns": [
        {"kind": "standalone", "question": "q1", "expected_source": "txt-long", "keywords": ["x"],
         "reference_answer": "8 km/h"},
        {"kind": "unanswerable", "question": "q2", "expected_source": None, "keywords": [],
         "reference_answer": ""},
    ]}]
    rows = [
        bench.TurnScore("improved", "c", 1, "standalone", "q1", "txt-long", "q1", False, True, 1, 1, answer="8 km/h."),
        bench.TurnScore("improved", "c", 2, "unanswerable", "q2", None, "q2", False, False, 0, 0, refused=True),
    ]
    graded = []
    bench.judge_turns(rows, conversations, lambda q, ref, ans: graded.append((q, ref, ans)) or ("correct", "CORRECT"))

    assert graded == [("q1", "8 km/h", "8 km/h.")]
    assert rows[0].judge_verdict == "correct" and rows[1].judge_verdict is None

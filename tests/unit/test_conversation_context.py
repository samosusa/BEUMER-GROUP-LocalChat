"""The follow-up gate and the query rewriter.

`resolve_search_query` takes an injectable `generate`, so everything here runs without a
GGUF: what is under test is the decision logic, not the model's prose.
"""

from __future__ import annotations

import pytest

from src.conversation_context import (
    _validate_rewrite,
    looks_like_followup,
    resolve_search_query,
)

HISTORY = [("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")]


@pytest.mark.parametrize(
    "question",
    [
        "What are his hobbies?",      # possessive pronoun, no subject of its own
        "And how often?",             # continuation opener
        "Why?",                       # bare wh-word
        "Is that logged?",            # demonstrative
        "What about the drive motor?",
        "Can they be reset?",
        "og hvad med motoren?",       # Danish: the app ships a Danish eval set
        "Maximum load?",              # bare fragment: asks nothing on its own
        "Any error codes?",
        "Battery voltage?",
    ],
)
def test_gate_catches_questions_that_need_earlier_turns(question):
    assert looks_like_followup(question) is True


@pytest.mark.parametrize(
    "question",
    [
        "Is Samo Susa 20 years old?",
        "How often should pull-cords be inspected?",
        "How do I test an emergency stop pull-cord?",
        "What is the maximum belt speed for the MSC800 scanner?",
        "Explain the calibration procedure for the HBS machine",
        "Who has right of way at the loading docks?",
        "Which chemicals need a spill kit nearby?",
    ],
)
def test_gate_leaves_standalone_questions_alone(question):
    """A false positive only costs one short LLM call, but rewriting a question that was
    already fine risks changing what the user asked for no reason."""
    assert looks_like_followup(question) is False


def test_rewrite_replaces_the_pronoun_for_retrieval():
    resolved = resolve_search_query(
        "What are his hobbies?", HISTORY, generate=lambda prompt, max_tokens: "What are Samo Susa's hobbies?"
    )
    assert resolved.search_query == "What are Samo Susa's hobbies?"
    assert resolved.rewritten is True


def test_no_history_means_no_rewrite_and_no_llm_call():
    """Every existing caller that passes no history must behave exactly as before - and
    must not pay for a generation it does not need."""

    def explode(prompt, max_tokens):
        raise AssertionError("the rewriter must not run without history")

    resolved = resolve_search_query("What is the speed?", [], generate=explode)
    assert resolved.search_query == "What is the speed?"
    assert resolved.rewritten is False


def test_standalone_question_skips_the_llm_call():
    def explode(prompt, max_tokens):
        raise AssertionError("the gate should have short-circuited this")

    resolved = resolve_search_query("Is Samo Susa 20 years old?", HISTORY, generate=explode)
    assert resolved.rewritten is False


def test_a_failing_model_never_fails_the_users_question():
    def boom(prompt, max_tokens):
        raise RuntimeError("model unloaded mid-request")

    resolved = resolve_search_query("What are his hobbies?", HISTORY, generate=boom)
    assert resolved.search_query == "What are his hobbies?"
    assert resolved.rewritten is False
    assert "RuntimeError" in resolved.reason


def test_the_rewrite_prompt_carries_the_conversation():
    seen = {}

    def capture(prompt, max_tokens):
        seen["prompt"] = prompt
        return "What are Samo Susa's hobbies?"

    resolve_search_query("What are his hobbies?", HISTORY, generate=capture)
    assert "Is Samo Susa 20 years old?" in seen["prompt"]
    assert seen["prompt"].rstrip().endswith("Standalone question:")


@pytest.mark.parametrize(
    "candidate,why",
    [
        ("", "empty"),
        ("   \n  ", "whitespace only"),
        ("Why?", "shorter than the question, so it dropped context instead of adding it"),
        ("x" * 400, "the model started answering instead of rewriting"),
    ],
)
def test_unusable_rewrites_are_rejected(candidate, why):
    assert _validate_rewrite(candidate, "What are his hobbies?") is None, why


@pytest.mark.parametrize(
    "candidate,expected",
    [
        ("What are Samo Susa's hobbies?", "What are Samo Susa's hobbies?"),
        ("Standalone question: What are Samo Susa's hobbies?", "What are Samo Susa's hobbies?"),
        ('"What are Samo Susa\'s hobbies?"', "What are Samo Susa's hobbies?"),
        ("What are Samo Susa's hobbies?\nAnswer: he plays padel.", "What are Samo Susa's hobbies?"),
    ],
)
def test_usable_rewrites_are_cleaned_not_discarded(candidate, expected):
    """Small models label, quote and over-answer. None of that is a reason to throw away
    an otherwise good rewrite."""
    assert _validate_rewrite(candidate, "What are his hobbies?") == expected


MANUAL_HISTORY = [("What is the rated load of the crane?", "The crane is rated for 5 tonnes.")]


@pytest.mark.parametrize(
    "rewrite",
    ["What is its maximum lifting height?", "What is its maximum lifting height, exactly?"],
)
def test_a_rewrite_that_brings_nothing_from_the_conversation_is_not_used(rewrite):
    """Echoing the question back, or padding it, passes the length check - but searching it
    would still be searching the user's own words while recording it as a rewrite."""
    resolved = resolve_search_query(
        "What is its maximum lifting height?", MANUAL_HISTORY, generate=lambda prompt, max_tokens: rewrite
    )
    assert resolved.search_query == "What is its maximum lifting height?"
    assert resolved.rewritten is False
    assert resolved.reason == "rewrite added nothing from the conversation"


def test_a_rewrite_that_names_what_the_conversation_was_about_is_used():
    resolved = resolve_search_query(
        "What is its maximum lifting height?",
        MANUAL_HISTORY,
        generate=lambda prompt, max_tokens: "What is the crane's maximum lifting height?",
    )
    assert resolved.search_query == "What is the crane's maximum lifting height?"
    assert resolved.rewritten is True


def test_the_rewriter_still_sees_a_question_that_found_nothing():
    """Its answer is withheld, but the question is what a following "it" refers to."""
    seen = {}

    def capture(prompt, max_tokens):
        seen["prompt"] = prompt
        return "Where is the spill kit for the battery charging area?"

    resolve_search_query(
        "And where is it?",
        [("Is there a spill kit for the battery charging area?", "")],
        generate=capture,
    )
    assert "User: Is there a spill kit for the battery charging area?" in seen["prompt"]
    assert "Assistant:" not in seen["prompt"].split("Conversation:")[1].split("Latest question:")[0]

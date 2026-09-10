from src.complexity import (
    DOCUMENT_TIERS,
    TIER_PARAMS,
    measure_complexity,
    measure_document_complexity,
)


def test_short_factual_question_is_simple():
    result = measure_complexity("What is the belt speed?")

    assert result.tier == "simple"
    assert result.score < 0.2


def test_analytical_question_is_complex():
    result = measure_complexity(
        "Why does the emergency stop trigger during startup, and what is the root cause?"
    )

    assert result.tier == "complex"
    assert "analytical" in result.signals
    assert "conjunction" in result.signals


def test_procedural_question_is_at_least_moderate():
    result = measure_complexity("What are the steps to replace the pull-cord switch?")

    assert result.tier in ("moderate", "complex")
    assert "procedural" in result.signals


def test_empty_question_is_simple():
    result = measure_complexity("")

    assert result.tier == "simple"
    assert result.word_count == 0
    assert result.question_count == 0


def test_every_tier_has_params():
    for tier in ("simple", "moderate", "complex"):
        assert "top_k" in TIER_PARAMS[tier]
        assert "max_tokens" in TIER_PARAMS[tier]


def test_short_plain_sentences_are_a_simple_document():
    result = measure_document_complexity(
        "The cat sat on the mat. It was a sunny day. The dog ran fast."
    )

    assert result.tier == "simple"
    assert result.score < 9


def test_dense_technical_text_is_not_simple():
    result = measure_document_complexity(
        "Emergency stop pull-cords must be tested at the start of every shift. Pull the cord at "
        "the midpoint of each belt section and confirm the drive motor cuts power within 500 "
        "milliseconds. Log the test in the shift handover sheet before the line is released for "
        "operation. Failure to perform this verification constitutes a violation of the mandatory "
        "lockout-tagout procedure and may result in unauthorized reactivation of hazardous "
        "machinery during maintenance intervals."
    )

    assert result.tier in ("moderate", "complex")
    assert result.score > 9


def test_empty_document_is_simple():
    result = measure_document_complexity("")

    assert result.tier == "simple"
    assert result.score == 0.0
    assert result.word_count == 0


def test_document_tier_is_always_one_of_document_tiers():
    for text in ("", "Short.", "A longer sentence with several more words in it than the last one."):
        assert measure_document_complexity(text).tier in DOCUMENT_TIERS

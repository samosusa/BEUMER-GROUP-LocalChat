from types import SimpleNamespace

from src import rag_service


def retrieved(text="The conveyor speed is 2 meters per second.", score=0.9):
    return [SimpleNamespace(
        score=score,
        chunk=SimpleNamespace(text=text, section="Specifications", page=3),
        document=SimpleNamespace(title="Guide"),
    )]


def _stub_context(monkeypatch, n_ctx=4096):
    monkeypatch.setattr(rag_service.llm_adapter, "context_size", lambda: n_ctx)
    monkeypatch.setattr(rag_service.llm_adapter, "count_tokens", lambda text: len(text.split()))


def test_answer_prompt_contains_retrieved_text(monkeypatch):
    chunks = retrieved()
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: chunks,
    )
    _stub_context(monkeypatch)
    prompts = []
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: prompts.append(prompt) or "2 m/s")

    response = rag_service.answer("What is the speed?", object())

    assert "The conveyor speed is 2 meters per second." in prompts[0]
    assert response["answer"] == "2 m/s"
    assert response["context"]["chunks_dropped"] == 0
    assert response["context"]["fits"] is True


def test_answer_returns_not_found_below_threshold(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(score=0.2),
    )

    response = rag_service.answer("Unrelated", object())

    assert response["not_found"] is True
    assert response["answer"] is None
    assert response["citations"] == []


def test_answer_citations_match_retrieved_chunks(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(),
    )
    _stub_context(monkeypatch)
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    response = rag_service.answer("Question", object())

    assert response["citations"] == [{
        "title": "Guide", "section": "Specifications", "page": 3, "score": 0.9,
    }]


def test_answer_expands_retrieval_query_with_prior_question(monkeypatch):
    """The Samo Susa scenario: retrieval for a pronoun-only follow-up must still carry
    the subject of the previous question, or FAISS has nothing to anchor the search to
    out of many similar CVs."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    assert captured_queries == ["Is Samo Susa 20 years old?\nWhat are his hobbies?"]


def test_answer_without_history_uses_bare_question_for_retrieval(monkeypatch):
    """No history (first turn, or history-less callers) must retrieve on the literal
    question with nothing prefixed - guards against _expand_retrieval_query changing
    behavior for every existing caller that doesn't pass history."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    rag_service.answer("What is the speed?", object())

    assert captured_queries == ["What is the speed?"]


def test_answer_prompt_includes_history_for_pronoun_resolution(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(),
    )
    _stub_context(monkeypatch)
    prompts = []
    monkeypatch.setattr(
        rag_service.llm_adapter, "generate", lambda prompt, max_tokens: prompts.append(prompt) or "answer"
    )

    rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    assert "Question: Is Samo Susa 20 years old?" in prompts[0]
    assert "Answer: Yes, Samo Susa is 20 years old." in prompts[0]
    assert "Question: What are his hobbies?\nAnswer:" in prompts[0]


def test_answer_drops_history_before_evidence_when_tight_on_context(monkeypatch):
    """Evidence chunks answer the question; history only helps phrasing. Under budget
    pressure the oldest history turn must go first, before any retrieved chunk is cut."""
    chunks = retrieved()
    history = [
        ("Is Samo Susa 20 years old and does he live in Slovenia?", "Yes to both, according to his CV on file.")
    ]
    question = "What are his hobbies?"

    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda q, db, top_k, project_id=None, include_general=False: chunks,
    )
    monkeypatch.setattr(rag_service.llm_adapter, "count_tokens", lambda text: len(text.split()))
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    # Derive the budget boundary from real measured prompt sizes rather than hand-counting
    # words: n_ctx is picked so it comfortably fits the chunk alone, but not the chunk plus
    # history - so dropping history (and only history) should make the prompt fit.
    tokens_without_history = len(rag_service.build_prompt(question, chunks, None).split())
    max_tokens = 10
    n_ctx = tokens_without_history + max_tokens + rag_service.CONTEXT_SAFETY_MARGIN + 2
    monkeypatch.setattr(rag_service.llm_adapter, "context_size", lambda: n_ctx)

    tokens_with_history = len(rag_service.build_prompt(question, chunks, history).split())
    assert tokens_with_history > n_ctx - max_tokens - rag_service.CONTEXT_SAFETY_MARGIN  # sanity: doesn't fit as-is

    response = rag_service.answer(question, object(), max_tokens=max_tokens, history=history)

    assert response["context"]["history_turns_dropped"] == 1
    assert response["context"]["chunks_dropped"] == 0
    assert response["context"]["fits"] is True
    assert len(response["citations"]) == 1


def test_answer_drops_weakest_chunks_to_fit_context(monkeypatch):
    chunks = [
        SimpleNamespace(
            score=0.9,
            chunk=SimpleNamespace(text="short strong chunk", section="A", page=1),
            document=SimpleNamespace(title="Guide"),
        ),
        SimpleNamespace(
            score=0.5,
            chunk=SimpleNamespace(text="weaker chunk padding " * 20, section="B", page=2),
            document=SimpleNamespace(title="Guide"),
        ),
    ]
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: chunks,
    )
    # Tiny context window forces the second (weaker) chunk to be dropped.
    _stub_context(monkeypatch, n_ctx=80)
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    response = rag_service.answer("Question", object())

    assert response["context"]["chunks_dropped"] == 1
    assert len(response["citations"]) == 1
    assert response["citations"][0]["score"] == 0.9
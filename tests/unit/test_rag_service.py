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


def _stub_generate(monkeypatch, rewrite="What are Samo Susa's hobbies?", answer="answer"):
    """One generate() now serves two callers - the query rewriter and the answer itself -
    so the stub tells them apart by the rewriter's own prompt tail."""
    prompts = []

    def fake_generate(prompt, max_tokens):
        prompts.append(prompt)
        return rewrite if prompt.rstrip().endswith("Standalone question:") else answer

    monkeypatch.setattr(rag_service.llm_adapter, "generate", fake_generate)
    return prompts


def test_answer_retrieves_on_the_standalone_rewrite_not_a_concatenation(monkeypatch):
    """The Samo Susa scenario. A pronoun-only follow-up has to reach FAISS carrying its
    subject - but as ONE coherent question, not two glued together. Concatenating the
    prior question embeds an average of two topics, which ranks documents about neither
    well; that is the failure this replaced."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch)

    response = rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    assert captured_queries == ["What are Samo Susa's hobbies?"]
    assert "\n" not in captured_queries[0]  # never a concatenation of turns
    assert response["search"] == {
        "query": "What are Samo Susa's hobbies?",
        "rewritten": True,
        "reason": "rewritten from conversation",
    }


def test_answer_falls_back_to_the_literal_question_when_the_rewrite_finds_nothing(monkeypatch):
    """A rewrite is a guess. If the corpus does not recognise it but does recognise what
    the user actually typed, the user's words win - silently searching a hallucinated
    rewrite is how a follow-up returns a confident answer about the wrong document."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return [] if query == "What are Samo Susa's hobbies?" else retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch)

    response = rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    assert captured_queries == ["What are Samo Susa's hobbies?", "What are his hobbies?"]
    assert response["search"]["query"] == "What are his hobbies?"
    assert response["search"]["rewritten"] is False
    assert response["not_found"] is False


def test_answer_keeps_the_users_question_when_the_rewrite_is_unusable(monkeypatch):
    """An empty or truncated rewrite must not become the search query."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch, rewrite="")

    response = rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    assert captured_queries == ["What are his hobbies?"]
    assert response["search"]["rewritten"] is False
    assert response["search"]["reason"] == "rewrite rejected as unusable"


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
    prompts = _stub_generate(monkeypatch)

    rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    # prompts[-1] is the answer prompt: a follow-up now also produces a rewrite prompt
    # first, and the two are deliberately formatted differently.
    answer_prompt = prompts[-1]
    assert "Question: Is Samo Susa 20 years old?" in answer_prompt
    assert "Answer: Yes, Samo Susa is 20 years old." in answer_prompt
    # Generation still receives the user's own words - only retrieval sees the rewrite.
    assert "Question: What are his hobbies?\nAnswer:" in answer_prompt


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
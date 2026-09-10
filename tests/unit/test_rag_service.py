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
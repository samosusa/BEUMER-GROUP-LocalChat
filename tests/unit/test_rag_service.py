from types import SimpleNamespace

from src import rag_service


def retrieved(text="The conveyor speed is 2 meters per second.", score=0.9):
    return [SimpleNamespace(
        score=score,
        chunk=SimpleNamespace(text=text, section="Specifications", page=3),
        document=SimpleNamespace(title="Guide"),
    )]


def test_answer_prompt_contains_retrieved_text(monkeypatch):
    chunks = retrieved()
    monkeypatch.setattr(rag_service, "retrieve_chunks", lambda question, db, top_k, project_id=None: chunks)
    prompts = []
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: prompts.append(prompt) or "2 m/s")

    response = rag_service.answer("What is the speed?", object())

    assert "The conveyor speed is 2 meters per second." in prompts[0]
    assert response["answer"] == "2 m/s"


def test_answer_returns_not_found_below_threshold(monkeypatch):
    monkeypatch.setattr(
        rag_service, "retrieve_chunks", lambda question, db, top_k, project_id=None: retrieved(score=0.2)
    )

    response = rag_service.answer("Unrelated", object())

    assert response["not_found"] is True
    assert response["answer"] is None
    assert response["citations"] == []


def test_answer_citations_match_retrieved_chunks(monkeypatch):
    monkeypatch.setattr(rag_service, "retrieve_chunks", lambda question, db, top_k, project_id=None: retrieved())
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    response = rag_service.answer("Question", object())

    assert response["citations"] == [{
        "title": "Guide", "section": "Specifications", "page": 3, "score": 0.9,
    }]
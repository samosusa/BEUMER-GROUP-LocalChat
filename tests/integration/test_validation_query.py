from fastapi.testclient import TestClient

from src.app import app


client = TestClient(app)


def test_empty_query_returns_validation_error():
    response = client.post("/query", json={"q": "   "})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"
    assert response.json()["details"]["q"] == "must not be empty"


def test_query_over_max_length_returns_validation_error():
    response = client.post("/query", json={"q": "x" * 2001})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"
    assert "2000" in response.json()["details"]["q"]


def test_empty_corpus_returns_not_found(monkeypatch):
    import src.rag_service as rag_service

    monkeypatch.setattr(rag_service, "retrieve_chunks", lambda question, db, top_k: [])
    response = client.post("/query", json={"q": "What is in the corpus?"})

    assert response.status_code == 200
    assert response.json()["not_found"] is True
    assert response.json()["answer"] is None
    assert response.json()["citations"] == []
    assert response.json()["suggestion"]
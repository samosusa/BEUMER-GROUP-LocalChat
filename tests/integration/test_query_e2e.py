from pathlib import Path

from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.models.document import Document


def test_query_retrieves_and_cites_ingested_document(monkeypatch):
    import src.api.ingest as ingest_api
    import src.rag_service as rag_service
    import src.retriever as retriever

    def fake_process_upload(job_id: int, title: str, path: str) -> None:
        from src.ingest.pipeline import run_pipeline

        with SessionLocal() as db:
            run_pipeline(
                db,
                job_id,
                title,
                path,
                embedder=lambda texts: [[1.0, 0.0] for _ in texts],
            )
        Path(path).unlink(missing_ok=True)

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)
    monkeypatch.setattr(
        retriever,
        "embed_query",
        lambda texts: [[0.0, 1.0] if "unrelated" in texts[0].lower() else [1.0, 0.0]],
    )
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "The speed is 2 m/s.")

    client = TestClient(app)
    title = "Query E2E Guide"
    ingest_response = client.post(
        "/ingest",
        data={"title": title},
        files={"file": ("guide.txt", b"The conveyor speed is 2 meters per second.", "text/plain")},
    )
    assert ingest_response.status_code == 202

    answer_response = client.post("/query", json={"q": "What is the conveyor speed?"})
    assert answer_response.status_code == 200
    result = answer_response.json()
    assert result["answer"]
    assert result["not_found"] is False
    assert result["citations"]
    # Not necessarily citations[0]: other tests ingest identically-worded content into
    # this same shared dev database with the same fake embedder, so ties on score are
    # possible and their order isn't (and shouldn't be) a guarantee this test relies on.
    assert any(citation["title"] == title for citation in result["citations"])

    unrelated_response = client.post("/query", json={"q": "Unrelated content question"})
    assert unrelated_response.status_code == 200
    assert unrelated_response.json()["not_found"] is True

    with SessionLocal() as db:
        document = db.query(Document).filter_by(title=title).first()
        assert document is not None
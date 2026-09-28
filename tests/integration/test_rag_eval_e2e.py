import json

from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.llm_adapter import llm_adapter

client = TestClient(app)


def test_rag_eval_runs_against_ingested_documents_and_stores_results(monkeypatch, tmp_path):
    import src.api.ingest as ingest_api
    import src.api.rag_eval as rag_eval_api
    import src.rag_service as rag_service
    import src.retriever as retriever
    from src.ingest.pipeline import run_pipeline
    from src.rag_eval import run_rag_eval_job

    def fake_process_upload(
        job_id: int, title: str, path: str, project_id: int | None = None, also_general: bool = False
    ) -> None:
        with SessionLocal() as db:
            run_pipeline(
                db,
                job_id,
                title,
                path,
                embedder=lambda texts: [[1.0, 0.0] for _ in texts],
                project_id=project_id,
                also_general=also_general,
            )

    monkeypatch.setattr(ingest_api, "process_upload", fake_process_upload)
    monkeypatch.setattr(retriever, "embed_query", lambda texts: [[1.0, 0.0]])
    # No real GGUF is loaded in this test process; these stand in for a working model so
    # _fit_to_context never tries to load one.
    monkeypatch.setattr(rag_service.llm_adapter, "context_size", lambda: 4096)
    monkeypatch.setattr(rag_service.llm_adapter, "count_tokens", lambda text: len(text.split()))

    def fake_generate(prompt: str, max_tokens: int) -> str:
        if "Respond with exactly one word" in prompt:
            return "CORRECT"
        return "The minimum general lighting level is 300 lux."

    monkeypatch.setattr(rag_service.llm_adapter, "generate", fake_generate)

    project_id = client.post("/projects", json={"name": "RAG Eval Test"}).json()["id"]

    title = "OPNL_B01_EN test doc"
    ingest_response = client.post(
        "/ingest",
        data={"title": title, "project_id": project_id},
        files={
            "file": (
                "guide.txt",
                b"General lighting must be at least 300 lux around the machinery.",
                "text/plain",
            )
        },
    )
    assert ingest_response.status_code == 202
    assert client.get(f"/status/{ingest_response.json()['job_id']}").json()["status"] == "completed"

    tiny_dataset = [
        {
            "source": "OPNL_B01_EN.pdf",
            "title_hint": "OPNL_B01",
            "questions": [
                {
                    "difficulty": "easy",
                    "question": "What is the minimum general lighting level?",
                    "expected_answer": "300 lux.",
                }
            ],
        }
    ]
    dataset_path = tmp_path / "qa.json"
    dataset_path.write_text(json.dumps(tiny_dataset), encoding="utf-8")

    def fake_process_rag_eval(job_id: int, project_id: int | None, dataset_id: str) -> None:
        with SessionLocal() as db:
            run_rag_eval_job(db, job_id, project_id, dataset_path=dataset_path)

    monkeypatch.setattr(rag_eval_api, "process_rag_eval", fake_process_rag_eval)

    start_response = client.post("/rag-eval", json={"project_id": project_id})
    assert start_response.status_code == 202
    job_id = start_response.json()["rag_eval_job_id"]

    status_response = client.get(f"/rag-eval/status/{job_id}")
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "completed"

    results_response = client.get(f"/rag-eval/results/{job_id}")
    assert results_response.status_code == 200
    body = results_response.json()
    assert body["status"] == "completed"
    assert len(body["results"]) == 1
    # The job records whichever answer model was active when it started - that is the
    # contract. Which model that is depends on the process it runs in: LLMAdapter is a
    # module-level singleton, and an earlier test module that lets _fit_to_context call the
    # real context_size() leaves a GGUF loaded in it. Asserting a bare None here instead
    # made this test pass only on a machine with an empty data/models/, and fail on one
    # where somebody had actually downloaded the models.
    active_answer_model = llm_adapter.active
    assert body["answer_model"] == (active_answer_model["model"] if active_answer_model else None)
    # The embedding adapter always has one, since it loads a default at construction time.
    assert body["embedding_model"]

    row = body["results"][0]
    assert row["not_found"] is False
    assert row["retrieval_hit"] is True
    assert row["judge_verdict"] == "correct"
    assert "300 lux" in row["actual_answer"]

    assert body["summary"]["total"] == 1
    assert body["summary"]["retrieval_hit_rate"] == 1.0
    assert body["summary"]["judge_counts"]["correct"] == 1
    assert body["summary"]["by_difficulty"]["easy"]["total"] == 1

    runs_response = client.get("/rag-eval/results")
    assert runs_response.status_code == 200
    runs = runs_response.json()
    assert any(run["rag_eval_job_id"] == job_id for run in runs)
    this_run = next(run for run in runs if run["rag_eval_job_id"] == job_id)
    # Same reasoning as above: the run listing must agree with the results payload about
    # which model was active, whatever that model happens to be in this process.
    assert this_run["answer_model"] == body["answer_model"]
    assert this_run["embedding_model"] == body["embedding_model"]


def test_rag_eval_datasets_endpoint_reports_the_bundled_question_set():
    response = client.get("/rag-eval/datasets")

    assert response.status_code == 200
    datasets = {dataset["id"]: dataset for dataset in response.json()}
    assert "rag_qa_pairs" in datasets
    bundled = datasets["rag_qa_pairs"]
    assert bundled["total_questions"] == 30
    assert len(bundled["documents"]) == 2
    assert all(doc["question_count"] == 15 for doc in bundled["documents"])


def test_rag_eval_status_unknown_job_returns_not_found():
    response = client.get("/rag-eval/status/999999999")

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_rag_eval_results_unknown_job_returns_not_found():
    response = client.get("/rag-eval/results/999999999")

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_rag_eval_rejects_unknown_project():
    response = client.post("/rag-eval", json={"project_id": 999999999})

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_rag_eval_rejects_unknown_dataset():
    response = client.post("/rag-eval", json={"dataset_id": "not-a-real-dataset"})

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"

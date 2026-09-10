from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal

client = TestClient(app)


def fake_process_benchmark(job_id: int) -> None:
    from src.benchmark import BenchmarkRow, run_benchmark_job

    def fake_run_one(model_path, device, prompt_spec):
        return BenchmarkRow(
            model=model_path.name,
            device=device,
            question=prompt_spec["question"],
            prompt_label=prompt_spec["label"],
            complexity_tier="simple",
            complexity_score=0.0,
            device_name="Fake Device",
            status="ok",
            load_s=0.1,
            ttft_s=0.05,
            gen_tokens=10,
            tok_s=42.0,
            total_s=0.3,
            peak_mem_mb=123.4,
            peak_vram_mb=None,
        )

    import src.benchmark as benchmark_module

    original_run_one = benchmark_module.run_one
    benchmark_module.run_one = fake_run_one
    try:
        with SessionLocal() as db:
            run_benchmark_job(db, job_id)
    finally:
        benchmark_module.run_one = original_run_one


def test_benchmark_job_runs_and_stores_results(monkeypatch):
    import src.api.benchmark as benchmark_api

    monkeypatch.setattr(benchmark_api, "process_benchmark", fake_process_benchmark)
    monkeypatch.setattr(benchmark_api, "gpu_available", lambda: True)

    response = client.post("/benchmark", json={"devices": ["cpu"]})
    assert response.status_code == 202
    job_id = response.json()["benchmark_job_id"]

    status_response = client.get(f"/benchmark/status/{job_id}")
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "completed"
    assert "of" in status_response.json()["progress"]

    results_response = client.get(f"/benchmark/results/{job_id}")
    assert results_response.status_code == 200
    body = results_response.json()
    assert body["status"] == "completed"
    assert len(body["results"]) >= 1
    row = body["results"][0]
    assert row["device"] == "cpu"
    assert row["status"] == "ok"
    assert row["tok_s"] == 42.0
    assert row["prompt_label"] in ("simple", "moderate", "complex")
    assert row["complexity_tier"] == "simple"
    assert {r["prompt_label"] for r in body["results"]} == {"simple", "moderate", "complex"}

    runs_response = client.get("/benchmark/results")
    assert runs_response.status_code == 200
    assert any(run["benchmark_job_id"] == job_id for run in runs_response.json())


def test_benchmark_status_unknown_job_returns_not_found():
    response = client.get("/benchmark/status/999999999")

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_benchmark_results_unknown_job_returns_not_found():
    response = client.get("/benchmark/results/999999999")

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_benchmark_rejects_unknown_device():
    response = client.post("/benchmark", json={"devices": ["tpu"]})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"


def test_benchmark_rejects_empty_devices():
    response = client.post("/benchmark", json={"devices": []})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"


def test_benchmark_rejects_gpu_without_support(monkeypatch):
    import src.api.benchmark as benchmark_api

    monkeypatch.setattr(benchmark_api, "gpu_available", lambda: False)

    response = client.post("/benchmark", json={"devices": ["gpu"]})

    assert response.status_code == 422
    assert response.json()["code"] == "ERR_GPU_UNAVAILABLE"


def test_benchmark_rejects_unknown_model_name():
    response = client.post("/benchmark", json={"devices": ["cpu"], "models": ["does-not-exist.gguf"]})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"
    assert "models" in response.json()["details"]

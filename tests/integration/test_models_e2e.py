from pathlib import Path

from fastapi.testclient import TestClient

from src.app import app
from src.llm_adapter import LLMAdapter


client = TestClient(app)


class FakeLlama:
    def __init__(self, model_path, n_gpu_layers, n_ctx, verbose):
        self.model_path = model_path
        self.n_gpu_layers = n_gpu_layers

    def close(self):
        pass


def test_list_models_reflects_models_dir(monkeypatch, tmp_path: Path):
    import src.api.models as models_api

    (tmp_path / "tiny-a-Q4_K_M.gguf").write_bytes(b"x")
    (tmp_path / "tiny-b-Q5_K_M.gguf").write_bytes(b"yy")
    fake_adapter = LLMAdapter(models_dir=tmp_path)
    monkeypatch.setattr(models_api, "llm_adapter", fake_adapter)
    monkeypatch.setattr(models_api, "list_model_files", fake_adapter.list_models)

    response = client.get("/models")

    assert response.status_code == 200
    names = {item["name"] for item in response.json()}
    assert names == {"tiny-a-Q4_K_M.gguf", "tiny-b-Q5_K_M.gguf"}


def test_active_model_is_null_before_any_selection(monkeypatch, tmp_path: Path):
    import src.api.models as models_api

    fake_adapter = LLMAdapter(models_dir=tmp_path)
    monkeypatch.setattr(models_api, "llm_adapter", fake_adapter)

    response = client.get("/models/active")

    assert response.status_code == 200
    assert response.json()["model"] is None
    assert response.json()["device"] is None


def test_set_active_model_loads_and_reports_active(monkeypatch, tmp_path: Path):
    import src.api.models as models_api
    import llama_cpp

    (tmp_path / "tiny-Q4_K_M.gguf").write_bytes(b"x")
    monkeypatch.setattr(llama_cpp, "Llama", FakeLlama, raising=False)
    fake_adapter = LLMAdapter(models_dir=tmp_path)
    monkeypatch.setattr(models_api, "llm_adapter", fake_adapter)
    monkeypatch.setattr(models_api, "gpu_available", lambda: True)

    response = client.post("/models/active", json={"model": "tiny-Q4_K_M.gguf", "device": "cpu"})

    assert response.status_code == 200
    assert response.json() == {"model": "tiny-Q4_K_M.gguf", "device": "cpu", "gpu_available": True}

    follow_up = client.get("/models/active")
    assert follow_up.json()["model"] == "tiny-Q4_K_M.gguf"
    assert follow_up.json()["device"] == "cpu"


def test_set_active_unknown_model_returns_not_found(monkeypatch, tmp_path: Path):
    import src.api.models as models_api

    fake_adapter = LLMAdapter(models_dir=tmp_path)
    monkeypatch.setattr(models_api, "llm_adapter", fake_adapter)

    response = client.post("/models/active", json={"model": "does-not-exist.gguf", "device": "cpu"})

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_set_active_invalid_device_returns_validation_error(tmp_path: Path):
    response = client.post("/models/active", json={"model": "anything.gguf", "device": "tpu"})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"
    assert "device" in response.json()["details"]


def test_set_active_gpu_without_support_returns_clear_error(monkeypatch, tmp_path: Path):
    import src.api.models as models_api

    (tmp_path / "tiny-Q4_K_M.gguf").write_bytes(b"x")
    fake_adapter = LLMAdapter(models_dir=tmp_path)
    monkeypatch.setattr(models_api, "llm_adapter", fake_adapter)
    monkeypatch.setattr(models_api, "gpu_available", lambda: False)

    response = client.post("/models/active", json={"model": "tiny-Q4_K_M.gguf", "device": "gpu"})

    assert response.status_code == 422
    assert response.json()["code"] == "ERR_GPU_UNAVAILABLE"

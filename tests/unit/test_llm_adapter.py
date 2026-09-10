from pathlib import Path

import pytest

from src.llm_adapter import (
    LLMAdapter,
    ModelNotFoundError,
    UnsupportedDeviceError,
    list_model_files,
)


class FakeLlama:
    instances: list["FakeLlama"] = []

    def __init__(self, model_path, n_gpu_layers, n_ctx, verbose):
        self.model_path = model_path
        self.n_gpu_layers = n_gpu_layers
        self.closed = False
        FakeLlama.instances.append(self)

    def __call__(self, prompt, **kwargs):
        return {"choices": [{"text": f"echo:{prompt}"}]}

    def tokenize(self, data: bytes, add_bos: bool = True) -> list[int]:
        # One "token" per whitespace-split word, plus one for BOS - good enough to
        # exercise count_tokens()'s plumbing without a real tokenizer.
        count = len(data.decode("utf-8").split())
        return list(range(count + (1 if add_bos else 0)))

    def n_ctx(self) -> int:
        return 4096

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _reset_fake_llama():
    FakeLlama.instances.clear()
    yield
    FakeLlama.instances.clear()


@pytest.fixture
def models_dir(tmp_path: Path) -> Path:
    (tmp_path / "model-a-Q5_K_M.gguf").write_bytes(b"a")
    (tmp_path / "model-b-Q4_K_M.gguf").write_bytes(b"bb")
    (tmp_path / "not-a-model.txt").write_bytes(b"ignore me")
    return tmp_path


def test_list_model_files_only_lists_gguf(models_dir: Path):
    files = list_model_files(models_dir)

    names = {item["name"] for item in files}
    assert names == {"model-a-Q5_K_M.gguf", "model-b-Q4_K_M.gguf"}
    by_name = {item["name"]: item for item in files}
    assert by_name["model-a-Q5_K_M.gguf"]["size_bytes"] == 1
    assert by_name["model-a-Q5_K_M.gguf"]["family"] == "model-a"


def test_list_model_files_missing_dir_returns_empty(tmp_path: Path):
    assert list_model_files(tmp_path / "does-not-exist") == []


def test_active_is_none_before_anything_loaded(models_dir: Path):
    adapter = LLMAdapter(models_dir=models_dir)

    assert adapter.active is None


def test_set_active_loads_requested_model_on_cpu(monkeypatch, models_dir: Path):
    monkeypatch.setattr("src.llm_adapter.gpu_available", lambda: True)
    import llama_cpp

    monkeypatch.setattr(llama_cpp, "Llama", FakeLlama, raising=False)

    adapter = LLMAdapter(models_dir=models_dir)
    result = adapter.set_active("model-a-Q5_K_M.gguf", "cpu")

    assert result == {"model": "model-a-Q5_K_M.gguf", "device": "cpu"}
    assert adapter.active == {"model": "model-a-Q5_K_M.gguf", "device": "cpu"}
    assert len(FakeLlama.instances) == 1
    assert FakeLlama.instances[0].n_gpu_layers == 0


def test_set_active_swap_unloads_previous_model(monkeypatch, models_dir: Path):
    import llama_cpp

    monkeypatch.setattr(llama_cpp, "Llama", FakeLlama, raising=False)

    adapter = LLMAdapter(models_dir=models_dir)
    adapter.set_active("model-a-Q5_K_M.gguf", "cpu")
    first = FakeLlama.instances[0]
    adapter.set_active("model-b-Q4_K_M.gguf", "cpu")

    assert first.closed is True
    assert adapter.active == {"model": "model-b-Q4_K_M.gguf", "device": "cpu"}
    assert len(FakeLlama.instances) == 2


def test_set_active_same_model_and_device_is_a_noop_reload(monkeypatch, models_dir: Path):
    import llama_cpp

    monkeypatch.setattr(llama_cpp, "Llama", FakeLlama, raising=False)

    adapter = LLMAdapter(models_dir=models_dir)
    adapter.set_active("model-a-Q5_K_M.gguf", "cpu")
    adapter.set_active("model-a-Q5_K_M.gguf", "cpu")

    assert len(FakeLlama.instances) == 1


def test_set_active_unknown_model_raises_not_found(models_dir: Path):
    adapter = LLMAdapter(models_dir=models_dir)

    with pytest.raises(ModelNotFoundError):
        adapter.set_active("does-not-exist.gguf", "cpu")


def test_set_active_invalid_device_raises_value_error(models_dir: Path):
    adapter = LLMAdapter(models_dir=models_dir)

    with pytest.raises(ValueError):
        adapter.set_active("model-a-Q5_K_M.gguf", "tpu")


def test_set_active_gpu_without_support_raises_clear_error(monkeypatch, models_dir: Path):
    monkeypatch.setattr("src.llm_adapter.gpu_available", lambda: False)

    adapter = LLMAdapter(models_dir=models_dir)
    with pytest.raises(UnsupportedDeviceError):
        adapter.set_active("model-a-Q5_K_M.gguf", "gpu")


def test_generate_uses_active_model(monkeypatch, models_dir: Path):
    import llama_cpp

    monkeypatch.setattr(llama_cpp, "Llama", FakeLlama, raising=False)

    adapter = LLMAdapter(models_dir=models_dir)
    adapter.set_active("model-a-Q5_K_M.gguf", "cpu")

    assert adapter.generate("hello") == "echo:hello"


def test_count_tokens_uses_active_model_tokenizer(monkeypatch, models_dir: Path):
    import llama_cpp

    monkeypatch.setattr(llama_cpp, "Llama", FakeLlama, raising=False)

    adapter = LLMAdapter(models_dir=models_dir)
    adapter.set_active("model-a-Q5_K_M.gguf", "cpu")

    assert adapter.count_tokens("four words right here") == 5  # +1 for BOS


def test_context_size_reads_active_model_n_ctx(monkeypatch, models_dir: Path):
    import llama_cpp

    monkeypatch.setattr(llama_cpp, "Llama", FakeLlama, raising=False)

    adapter = LLMAdapter(models_dir=models_dir)
    adapter.set_active("model-a-Q5_K_M.gguf", "cpu")

    assert adapter.context_size() == 4096

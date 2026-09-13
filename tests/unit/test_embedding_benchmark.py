import pytest

from src.embedding_benchmark import EMBEDDING_BENCHMARK_TEXTS, resolve_models, run_one
from src.ingest.embedder import EMBEDDING_MODELS, EmbeddingModel


class _FakeSentenceTransformer:
    def __init__(self, dimension: int) -> None:
        self.dimension = dimension

    def encode(self, texts, **kwargs):
        return [[1.0] * self.dimension for _ in texts]


@pytest.fixture(autouse=True)
def _fake_embedding_models(monkeypatch):
    monkeypatch.setattr(EmbeddingModel, "_get_model", lambda self: _FakeSentenceTransformer(self.spec.dimension))


def test_resolve_models_defaults_to_every_registered_model():
    assert resolve_models(None) == list(EMBEDDING_MODELS)


def test_resolve_models_filters_to_the_requested_subset():
    resolved = resolve_models(["BAAI/bge-small-en-v1.5"])

    assert resolved == ["BAAI/bge-small-en-v1.5"]


def test_run_one_reports_throughput_for_a_working_model():
    text_spec = EMBEDDING_BENCHMARK_TEXTS[0]

    row = run_one("BAAI/bge-small-en-v1.5", text_spec)

    assert row.status == "ok"
    assert row.dimension == 384
    assert row.text_label == text_spec["label"]
    assert row.text_count == len(text_spec["texts"])
    assert row.load_s is not None and row.load_s >= 0
    assert row.embed_s is not None and row.embed_s >= 0
    assert row.texts_per_s is not None and row.texts_per_s > 0


def test_run_one_reports_error_status_when_embedder_returns_the_wrong_dimension(monkeypatch):
    class WrongDimensionModel:
        def encode(self, texts, **kwargs):
            return [[0.0, 0.0] for _ in texts]

    monkeypatch.setattr(EmbeddingModel, "_get_model", lambda self: WrongDimensionModel())

    row = run_one("BAAI/bge-small-en-v1.5", EMBEDDING_BENCHMARK_TEXTS[0])

    assert row.status == "error"
    assert row.detail

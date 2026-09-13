import pytest

from src.ingest.embedder import (
    EMBEDDING_MODELS,
    EmbeddingAdapter,
    EmbeddingModel,
    EmbeddingModelNotFoundError,
    list_embedding_models,
)


class FakeModel:
    def encode(self, texts, **kwargs):
        return [[0.1, 0.2, 0.3, 0.4] for _ in texts]


def test_embedding_output_dimension():
    model = EmbeddingModel("nomic-ai/nomic-embed-text-v1.5")
    model._model = FakeModel()
    vectors = model.embed(["sample"])

    assert len(vectors) == 1
    assert len(vectors[0]) == 4


def test_embed_and_embed_query_use_the_model_specific_prefixes():
    seen: list[str] = []

    class RecordingModel:
        def encode(self, texts, **kwargs):
            seen.extend(texts)
            return [[0.0] for _ in texts]

    model = EmbeddingModel("intfloat/e5-base-v2")
    model._model = RecordingModel()
    model.embed(["doc text"])
    model.embed_query(["query text"])

    assert seen == ["passage: doc text", "query: query text"]


def test_unknown_model_name_raises():
    with pytest.raises(EmbeddingModelNotFoundError):
        EmbeddingModel("not-a-real-model")


def test_list_embedding_models_covers_every_registered_spec():
    names = {item["name"] for item in list_embedding_models()}
    assert names == set(EMBEDDING_MODELS)


def test_adapter_set_active_switches_and_reports_active_model():
    adapter = EmbeddingAdapter("nomic-ai/nomic-embed-text-v1.5")

    active = adapter.set_active("BAAI/bge-small-en-v1.5")

    assert active == {"model": "BAAI/bge-small-en-v1.5", "dimension": 384}
    assert adapter.active == active


def test_adapter_set_active_rejects_unknown_model():
    adapter = EmbeddingAdapter("nomic-ai/nomic-embed-text-v1.5")

    with pytest.raises(EmbeddingModelNotFoundError):
        adapter.set_active("not-a-real-model")

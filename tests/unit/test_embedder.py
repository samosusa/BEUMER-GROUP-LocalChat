from src.ingest.embedder import NomicEmbedder


def test_embedding_output_dimension(monkeypatch):
    class FakeModel:
        def encode(self, texts, **kwargs):
            assert texts == ["search_document: sample"]
            return [[0.1, 0.2, 0.3, 0.4]]

    embedder = NomicEmbedder()
    embedder._model = FakeModel()
    vectors = embedder.embed(["sample"])

    assert len(vectors) == 1
    assert len(vectors[0]) == 4
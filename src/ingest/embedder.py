from __future__ import annotations

from typing import Any


MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5"


class NomicEmbedder:
    def __init__(self, model_name: str = MODEL_NAME):
        self.model_name = model_name
        self._model: Any = None

    def _get_model(self) -> Any:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name, device="cpu", trust_remote_code=True)
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = self._get_model().encode(
            [f"search_document: {text}" for text in texts],
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return vectors.tolist() if hasattr(vectors, "tolist") else vectors


embedder = NomicEmbedder()


def embed(texts: list[str]) -> list[list[float]]:
    return embedder.embed(texts)
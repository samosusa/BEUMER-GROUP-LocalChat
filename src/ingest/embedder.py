from __future__ import annotations

import gc
import json
import os
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any


ROOT = Path(__file__).resolve().parent.parent.parent
EMBEDDING_MODELS_CONFIG = ROOT / "config" / "embedding_models.json"


@dataclass(frozen=True)
class EmbeddingModelSpec:
    name: str
    dimension: int
    description: str
    # Retrieval-tuned embedding models are trained on inputs wrapped in a specific prefix
    # string, different per model family and often asymmetric between what gets indexed and
    # what gets searched with. Passing the wrong prefix (or none) doesn't error - it just
    # quietly produces worse embeddings, so this has to be tracked per model rather than
    # hardcoded once the way the original single-model version of this file did.
    document_prefix: str = ""
    query_prefix: str = ""
    # Only nomic-embed ships custom modeling code on the Hub that requires this; granting it
    # to every model by default would let an arbitrary future model name run arbitrary code.
    trust_remote_code: bool = False


def _load_embedding_models(path: Path) -> dict[str, EmbeddingModelSpec]:
    """Selectable embedding models live in config/embedding_models.json, not in code, so
    adding or tuning one (name, dimension, prefixes) never needs a Python change or a
    redeploy of the frontend - GET /embeddings/models reads straight off this file."""
    entries = json.loads(path.read_text(encoding="utf-8"))
    return {
        entry["name"]: EmbeddingModelSpec(
            name=entry["name"],
            dimension=entry["dimension"],
            description=entry["description"],
            document_prefix=entry.get("document_prefix", ""),
            query_prefix=entry.get("query_prefix", ""),
            trust_remote_code=entry.get("trust_remote_code", False),
        )
        for entry in entries
    }


EMBEDDING_MODELS: dict[str, EmbeddingModelSpec] = _load_embedding_models(EMBEDDING_MODELS_CONFIG)

DEFAULT_MODEL_NAME = os.getenv("LOCALCHAT_EMBEDDING_MODEL", "nomic-ai/nomic-embed-text-v1.5")


class EmbeddingModelNotFoundError(ValueError):
    pass


def list_embedding_models() -> list[dict[str, Any]]:
    return [
        {
            "name": spec.name,
            "dimension": spec.dimension,
            "description": spec.description,
        }
        for spec in EMBEDDING_MODELS.values()
    ]


class EmbeddingModel:
    """Wraps one loaded sentence-transformers model. Prefixes are looked up from
    EMBEDDING_MODELS by name, so callers never have to know a given model's convention."""

    def __init__(self, model_name: str) -> None:
        if model_name not in EMBEDDING_MODELS:
            raise EmbeddingModelNotFoundError(
                f"Unknown embedding model '{model_name}'. Choose one from GET /embeddings/models."
            )
        self.model_name = model_name
        self.spec = EMBEDDING_MODELS[model_name]
        self._model: Any = None

    def _get_model(self) -> Any:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(
                self.model_name, device="cpu", trust_remote_code=self.spec.trust_remote_code
            )
        return self._model

    def _encode(self, texts: list[str], prefix: str) -> list[list[float]]:
        if not texts:
            return []
        vectors = self._get_model().encode(
            [f"{prefix}{text}" for text in texts],
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return vectors.tolist() if hasattr(vectors, "tolist") else vectors

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._encode(texts, self.spec.document_prefix)

    def embed_query(self, texts: list[str]) -> list[list[float]]:
        return self._encode(texts, self.spec.query_prefix)

    def load(self) -> None:
        """Forces the model to load now rather than lazily on first embed() call - used by
        the embedding benchmark (src/embedding_benchmark.py) so load time is measured on its
        own instead of folded into the first encode() call's timing."""
        self._get_model()

    def unload(self) -> None:
        self._model = None
        gc.collect()


class EmbeddingAdapter:
    """The one place an embedding-model swap happens, mirroring src/llm_adapter.py's
    LLMAdapter: holds whichever EmbeddingModel is currently active and is what
    embed()/embed_query() (and therefore ingestion and retrieval) actually call."""

    def __init__(self, model_name: str | None = None) -> None:
        self._lock = RLock()
        self._embedding_model = EmbeddingModel(model_name or DEFAULT_MODEL_NAME)

    @property
    def active(self) -> dict[str, Any]:
        with self._lock:
            spec = self._embedding_model.spec
            return {"model": spec.name, "dimension": spec.dimension}

    def list_models(self) -> list[dict[str, Any]]:
        return list_embedding_models()

    def set_active(self, model_name: str) -> dict[str, Any]:
        with self._lock:
            if self._embedding_model.model_name == model_name:
                return self.active
            old_model = self._embedding_model
            self._embedding_model = EmbeddingModel(model_name)
            old_model.unload()
            return self.active

    def embed(self, texts: list[str]) -> list[list[float]]:
        with self._lock:
            model = self._embedding_model
        return model.embed(texts)

    def embed_query(self, texts: list[str]) -> list[list[float]]:
        with self._lock:
            model = self._embedding_model
        return model.embed_query(texts)


embedding_adapter = EmbeddingAdapter()


def embed(texts: list[str]) -> list[list[float]]:
    return embedding_adapter.embed(texts)


def embed_query(texts: list[str]) -> list[list[float]]:
    return embedding_adapter.embed_query(texts)

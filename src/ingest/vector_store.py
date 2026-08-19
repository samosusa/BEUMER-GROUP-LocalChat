from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import faiss
import numpy as np


ROOT = Path(__file__).resolve().parent.parent.parent
VECTOR_DIR = ROOT / "data" / "vectors"


class FaissVectorStore:
    def __init__(self, vector_dir: Path | None = None):
        configured_dir = os.getenv("LOCALCHAT_VECTOR_DIR")
        self.vector_dir = vector_dir or Path(configured_dir or VECTOR_DIR)
        self._indexes: dict[int, Any] = {}

    def create_index(self, doc_id: int, dimension: int | None = None) -> Any:
        if dimension is None:
            raise ValueError("dimension is required when creating an index")
        index = faiss.IndexFlatIP(dimension)
        self._indexes[doc_id] = index
        return index

    def add_vectors(self, doc_id: int, vectors: list[list[float]]) -> int:
        if doc_id not in self._indexes:
            if not vectors:
                raise ValueError("Cannot create an index without vectors")
            self.create_index(doc_id, len(vectors[0]))
        self._indexes[doc_id].add(np.asarray(vectors, dtype="float32"))
        return self._indexes[doc_id].ntotal

    def save(self, doc_id: int) -> Path:
        if doc_id not in self._indexes:
            raise KeyError(f"No index for document {doc_id}")
        self.vector_dir.mkdir(parents=True, exist_ok=True)
        path = self.path_for(doc_id)
        faiss.write_index(self._indexes[doc_id], str(path))
        return path

    def path_for(self, doc_id: int) -> Path:
        return self.vector_dir / f"{doc_id}.index"

    def load(self, doc_id: int) -> Any:
        return faiss.read_index(str(self.path_for(doc_id)))
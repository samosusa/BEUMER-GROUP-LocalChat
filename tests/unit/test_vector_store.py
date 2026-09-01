import faiss
import numpy as np

from src.ingest.vector_store import FaissVectorStore


def test_saved_vectors_can_be_reloaded_and_searched(tmp_path):
    store = FaissVectorStore(tmp_path)
    vectors = [[1.0, 0.0], [0.0, 1.0], [0.8, 0.2]]

    assert store.add_vectors(7, vectors) == 3
    path = store.save(7)
    loaded = faiss.read_index(str(path))
    scores, indices = loaded.search(np.asarray([[1.0, 0.0]], dtype="float32"), 2)

    assert loaded.ntotal == 3
    assert list(indices[0]) == [0, 2]
    assert scores[0][0] > scores[0][1]
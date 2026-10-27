"""Reciprocal rank fusion (Cormack, Clarke and Buettcher, 2009).

Merges several rankings of the same kind of item into one, using only each item's rank in
each list: score = sum over lists of 1 / (k + rank). Ranks are comparable across lists even
when the underlying scores are not - a BM25 score and a cosine similarity live on different
scales, and so do two cosine scores from two different queries - which is exactly the
situation of hybrid search and of searching both a rewrite and the user's own words.

The item kept for a key is the occurrence with the highest `.score`, so a caller that
thresholds on similarity (MIN_SIMILARITY, the relative cutoff) still sees a cosine score,
not the fused rank score.
"""

from __future__ import annotations

from typing import Any, Callable, Hashable, Iterable, Sequence

DEFAULT_K = 60


def chunk_key(item: Any) -> Hashable:
    """Identifies a retrieved passage across rankings: document id plus chunk position."""
    chunk = item.chunk
    position = getattr(chunk, "chunk_index", None)
    return (getattr(item.document, "id", None), position if position is not None else getattr(chunk, "text", id(chunk)))


def reciprocal_rank_fusion(
    rankings: Iterable[Sequence[Any]],
    k: int = DEFAULT_K,
    key: Callable[[Any], Hashable] = chunk_key,
) -> list[Any]:
    fused: dict[Hashable, float] = {}
    best: dict[Hashable, Any] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            item_key = key(item)
            fused[item_key] = fused.get(item_key, 0.0) + 1.0 / (k + rank)
            if item_key not in best or item.score > best[item_key].score:
                best[item_key] = item
    # Ties on the fused score - common when two lists disagree completely - fall back to
    # the similarity score, so the order stays deterministic and sensible.
    order = sorted(fused, key=lambda item_key: (-fused[item_key], -best[item_key].score))
    return [best[item_key] for item_key in order]

from types import SimpleNamespace

from src.fusion import reciprocal_rank_fusion


def hit(doc_id, chunk_index, score):
    return SimpleNamespace(
        score=score,
        chunk=SimpleNamespace(chunk_index=chunk_index, text=f"{doc_id}:{chunk_index}"),
        document=SimpleNamespace(id=doc_id),
    )


def keys(items):
    return [(item.document.id, item.chunk.chunk_index) for item in items]


def test_a_passage_both_rankings_agree_on_beats_one_only_a_single_ranking_puts_first():
    rewrite = [hit(1, 0, 0.80), hit(2, 0, 0.70)]
    literal = [hit(3, 0, 0.90), hit(2, 0, 0.60)]

    fused = reciprocal_rank_fusion([rewrite, literal])

    assert keys(fused)[0] == (2, 0)
    assert set(keys(fused)) == {(1, 0), (2, 0), (3, 0)}


def test_each_passage_appears_once_with_its_best_similarity():
    fused = reciprocal_rank_fusion([[hit(1, 0, 0.55)], [hit(1, 0, 0.72)]])

    assert len(fused) == 1
    assert fused[0].score == 0.72  # thresholds downstream still see a cosine score


def test_ties_fall_back_to_similarity():
    # Rank 1 in one list each: equal fused scores, so the higher similarity goes first.
    fused = reciprocal_rank_fusion([[hit(1, 0, 0.40)], [hit(2, 0, 0.65)]])

    assert keys(fused) == [(2, 0), (1, 0)]


def test_empty_rankings_fuse_to_nothing():
    assert reciprocal_rank_fusion([[], []]) == []
    assert keys(reciprocal_rank_fusion([[], [hit(1, 0, 0.5)]])) == [(1, 0)]

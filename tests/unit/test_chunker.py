from src.ingest.chunker import chunk_text


def test_chunk_size_and_overlap():
    words = [f"word-{index}" for index in range(1_100)]
    chunks = chunk_text(" ".join(words), max_words=500, overlap_words=50)

    assert len(chunks) == 3
    assert len(chunks[0].text.split()) == 500
    assert len(chunks[1].text.split()) == 500
    assert len(chunks[2].text.split()) == 200
    assert chunks[0].text.split()[-50:] == chunks[1].text.split()[:50]
    assert chunks[1].text.split()[-50:] == chunks[2].text.split()[:50]
    assert [chunk.chunk_index for chunk in chunks] == [0, 1, 2]
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from src.ingest.loader import LoadedPage, load_file


WORD_PATTERN = re.compile(r"\S+")
HEADING_PATTERN = re.compile(r"^#{1,6}\s+(.+?)\s*$")


@dataclass(frozen=True)
class TextChunk:
    chunk_index: int
    text: str
    page: int | None
    section: str | None


def _word_records(pages: list[LoadedPage]) -> list[tuple[str, int | None, str | None]]:
    records: list[tuple[str, int | None, str | None]] = []
    section: str | None = None
    for loaded_page in pages:
        for line in loaded_page.text.splitlines():
            heading = HEADING_PATTERN.match(line)
            if heading:
                section = heading.group(1)
            for word in WORD_PATTERN.findall(line):
                records.append((word, loaded_page.page, section))
    return records


def chunk_pages(pages: list[LoadedPage], max_words: int = 500, overlap_words: int = 50) -> list[TextChunk]:
    if max_words <= 0 or overlap_words < 0 or overlap_words >= max_words:
        raise ValueError("overlap_words must be non-negative and less than max_words")

    records = _word_records(pages)
    chunks: list[TextChunk] = []
    start = 0
    while start < len(records):
        end = min(start + max_words, len(records))
        window = records[start:end]
        chunks.append(
            TextChunk(
                chunk_index=len(chunks),
                text=" ".join(word for word, _, _ in window),
                page=window[0][1],
                section=next((section for _, _, section in window if section), None),
            )
        )
        if end == len(records):
            break
        start = end - overlap_words
    return chunks


def chunk_text(text: str, max_words: int = 500, overlap_words: int = 50) -> list[TextChunk]:
    return chunk_pages([LoadedPage(text)], max_words=max_words, overlap_words=overlap_words)


def chunk_file(path: str | Path, max_words: int = 500, overlap_words: int = 50) -> list[TextChunk]:
    return chunk_pages(load_file(path), max_words=max_words, overlap_words=overlap_words)
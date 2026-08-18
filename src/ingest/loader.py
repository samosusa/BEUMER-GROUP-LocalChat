from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


SUPPORTED_SUFFIXES = {".pdf", ".md", ".markdown", ".txt"}


@dataclass(frozen=True)
class LoadedPage:
    text: str
    page: int | None = None


def load_file(path: str | Path) -> list[LoadedPage]:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ValueError(f"Unsupported file format: {suffix or 'none'}")

    if suffix == ".pdf":
        return [LoadedPage(page.extract_text() or "", index + 1) for index, page in enumerate(PdfReader(file_path).pages)]

    return [LoadedPage(file_path.read_text(encoding="utf-8"), 1)]


def load_text(path: str | Path) -> str:
    return "\n\n".join(page.text for page in load_file(path))
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from docx import Document as DocxDocument
from pypdf import PdfReader


SUPPORTED_SUFFIXES = {".pdf", ".docx", ".md", ".markdown", ".txt"}


@dataclass(frozen=True)
class LoadedPage:
    text: str
    page: int | None = None


def _load_pdf(path: Path) -> list[LoadedPage]:
    return [LoadedPage(page.extract_text() or "", index + 1) for index, page in enumerate(PdfReader(path).pages)]


def _load_docx(path: Path) -> list[LoadedPage]:
    lines: list[str] = []
    for paragraph in DocxDocument(str(path)).paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style_name = paragraph.style.name if paragraph.style else ""
        heading_level = "".join(char for char in style_name if char.isdigit())
        if style_name.startswith("Heading") and heading_level:
            lines.append(f"{'#' * min(int(heading_level), 6)} {text}")
        else:
            lines.append(text)
    return [LoadedPage("\n".join(lines), 1)]


def load_file(path: str | Path) -> list[LoadedPage]:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ValueError(f"Unsupported file format: {suffix or 'none'}")

    if suffix == ".pdf":
        return _load_pdf(file_path)
    if suffix == ".docx":
        return _load_docx(file_path)

    return [LoadedPage(file_path.read_text(encoding="utf-8"), 1)]

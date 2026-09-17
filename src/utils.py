from __future__ import annotations

import hashlib
from pathlib import Path

from sqlalchemy.orm import Session

from src.errors import AppError
from src.models.document import Document


def file_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_unique_checksum(db: Session, checksum: str) -> None:
    """Shared by POST /docs and POST /ingest so identical file content is rejected the same
    way regardless of how it entered the system."""
    if db.query(Document).filter_by(checksum=checksum).first() is not None:
        raise AppError(
            "ERR_DUPLICATE_DOCUMENT",
            "A document with this file content already exists",
            {"checksum": checksum},
            status_code=409,
        )

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import get_db
from src.errors import AppError
from src.models.document import Document


router = APIRouter()


class DocumentCreate(BaseModel):
    title: str
    path: str


class DocumentResponse(BaseModel):
    id: int
    title: str
    path: str
    checksum: str
    version: int
    uploaded_at: datetime
    indexed_at: datetime | None

    model_config = {"from_attributes": True}


def file_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


@router.post("/docs", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def create_document(payload: DocumentCreate, db: Session = Depends(get_db)) -> Document:
    if not payload.title.strip():
        raise AppError("ERR_VALIDATION", "Request validation failed", {"title": "must not be empty"})
    if len(payload.title) > 200:
        raise AppError(
            "ERR_VALIDATION",
            "Request validation failed",
            {"title": "must be at most 200 characters"},
        )
    path = Path(payload.path)
    if not path.is_file():
        raise AppError("ERR_FILE_NOT_FOUND", "Document file does not exist", {"path": payload.path})

    checksum = file_checksum(path)
    if db.query(Document).filter_by(checksum=checksum).first() is not None:
        raise AppError(
            "ERR_DUPLICATE_DOCUMENT",
            "A document with this file content already exists",
            {"checksum": checksum},
            status_code=409,
        )

    document = Document(
        title=payload.title,
        path=payload.path,
        checksum=checksum,
        version=1,
        uploaded_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/docs/{document_id}", response_model=DocumentResponse)
def get_document(document_id: int, db: Session = Depends(get_db)) -> Document:
    document = db.get(Document, document_id)
    if document is None:
        raise AppError("ERR_NOT_FOUND", "Document not found", {"document_id": document_id}, status_code=404)
    return document


@router.delete("/docs/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: int, db: Session = Depends(get_db)) -> Response:
    document = db.get(Document, document_id)
    if document is None:
        raise AppError("ERR_NOT_FOUND", "Document not found", {"document_id": document_id}, status_code=404)
    db.delete(document)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
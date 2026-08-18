from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import get_db
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
    path = Path(payload.path)
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Document file does not exist")

    document = Document(
        title=payload.title,
        path=payload.path,
        checksum=file_checksum(path),
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
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.delete("/docs/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: int, db: Session = Depends(get_db)) -> Response:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(document)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
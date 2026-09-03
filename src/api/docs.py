from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api.projects import get_project_or_404
from src.db import get_db
from src.errors import AppError
from src.ingest.vector_store import FaissVectorStore
from src.models.document import Document
from src.utils import file_checksum


router = APIRouter()


class DocumentCreate(BaseModel):
    title: str
    path: str
    project_id: int | None = None


class DocumentResponse(BaseModel):
    id: int
    title: str
    path: str
    checksum: str
    version: int
    project_id: int | None
    uploaded_at: datetime
    indexed_at: datetime | None

    model_config = {"from_attributes": True}


def _validate_title(title: str) -> None:
    if not title.strip():
        raise AppError("ERR_VALIDATION", "Request validation failed", {"title": "must not be empty"})
    if len(title) > 200:
        raise AppError(
            "ERR_VALIDATION",
            "Request validation failed",
            {"title": "must be at most 200 characters"},
        )


def _ensure_unique_checksum(db: Session, checksum: str) -> None:
    if db.query(Document).filter_by(checksum=checksum).first() is not None:
        raise AppError(
            "ERR_DUPLICATE_DOCUMENT",
            "A document with this file content already exists",
            {"checksum": checksum},
            status_code=409,
        )


@router.post("/docs", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def create_document(payload: DocumentCreate, db: Session = Depends(get_db)) -> Document:
    _validate_title(payload.title)
    path = Path(payload.path)
    if not path.is_file():
        raise AppError("ERR_FILE_NOT_FOUND", "Document file does not exist", {"path": payload.path})

    checksum = file_checksum(path)
    _ensure_unique_checksum(db, checksum)
    if payload.project_id is not None:
        get_project_or_404(db, payload.project_id)

    document = Document(
        title=payload.title,
        path=payload.path,
        checksum=checksum,
        version=1,
        project_id=payload.project_id,
        uploaded_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/docs", response_model=list[DocumentResponse])
def list_documents(db: Session = Depends(get_db)) -> list[Document]:
    return db.query(Document).order_by(Document.id.desc()).all()


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
    # Chunk rows cascade via the DB's ON DELETE CASCADE; only the FAISS file needs
    # explicit cleanup. DB rows first, then the file, so a crash mid-delete leaves at
    # worst an orphaned file (harmless, easy to spot) rather than rows pointing at a
    # file that's already gone.
    db.delete(document)
    db.commit()
    FaissVectorStore().delete(document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/docs", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_documents(project_id: str | None = None, db: Session = Depends(get_db)) -> Response:
    """Bulk delete. No `project_id` removes every document; `project_id=null` removes only
    the general corpus (no project); a numeric `project_id` removes just that project's
    documents — mostly redundant with deleting the project itself, which cascades this the
    same way, but kept orthogonal since a caller may want to clear a project's documents
    without removing the project."""
    query = db.query(Document)
    if project_id is not None:
        if project_id == "null":
            query = query.filter(Document.project_id.is_(None))
        else:
            try:
                query = query.filter(Document.project_id == int(project_id))
            except ValueError:
                raise AppError(
                    "ERR_VALIDATION",
                    "Request validation failed",
                    {"project_id": "must be an integer or 'null'"},
                )

    documents = query.all()
    document_ids = [document.id for document in documents]
    for document in documents:
        db.delete(document)
    db.commit()
    # DB rows first, then the files, for the same crash-safety reason as the single delete.
    store = FaissVectorStore()
    for document_id in document_ids:
        store.delete(document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
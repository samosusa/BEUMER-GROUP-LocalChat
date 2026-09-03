from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api.projects import get_project_or_404
from src.db import get_db
from src.errors import AppError
from src.models.conversation import Conversation
from src.models.message import Message
from src.rag_service import answer
from src.validation import ROOT, validate_against_schema


router = APIRouter()

TITLE_MAX_LENGTH = 60


class ConversationCreate(BaseModel):
    title: str | None = None
    project_id: int | None = None


class ConversationUpdate(BaseModel):
    title: str | None = None


class MessageCreate(BaseModel):
    q: str | None = None
    # Optional per-turn override of the conversation's own project. 'general' searches the
    # corpus that has no project (project_id IS NULL) even for a project-linked conversation;
    # anything else (including 'both', not yet supported by the retriever) keeps the
    # conversation's own project scope.
    scope: str | None = None


class ConversationResponse(BaseModel):
    id: int
    title: str | None
    project_id: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    role: str
    text: str
    citations: list[dict] | None
    not_found: bool | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetailResponse(ConversationResponse):
    messages: list[MessageResponse]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _auto_title(question: str) -> str:
    if len(question) <= TITLE_MAX_LENGTH:
        return question
    return question[: TITLE_MAX_LENGTH - 1].rstrip() + "…"


def _validate_title(title: str) -> None:
    if len(title) > 200:
        raise AppError(
            "ERR_VALIDATION", "Request validation failed", {"title": "must be at most 200 characters"}
        )


def _get_conversation_or_404(db: Session, conversation_id: int) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise AppError(
            "ERR_NOT_FOUND", "Conversation not found", {"conversation_id": conversation_id}, status_code=404
        )
    return conversation


@router.post("/conversations", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
def create_conversation(payload: ConversationCreate, db: Session = Depends(get_db)) -> Conversation:
    title = payload.title.strip() if payload.title else None
    if title:
        _validate_title(title)
    if payload.project_id is not None:
        get_project_or_404(db, payload.project_id)
    now = _now()
    conversation = Conversation(
        title=title or None, project_id=payload.project_id, created_at=now, updated_at=now
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.get("/conversations", response_model=list[ConversationResponse])
def list_conversations(db: Session = Depends(get_db)) -> list[Conversation]:
    return db.query(Conversation).order_by(Conversation.updated_at.desc()).all()


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
def get_conversation(conversation_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    conversation = _get_conversation_or_404(db, conversation_id)
    messages = (
        db.query(Message).filter_by(conversation_id=conversation_id).order_by(Message.id.asc()).all()
    )
    return {
        "id": conversation.id,
        "title": conversation.title,
        "project_id": conversation.project_id,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "messages": messages,
    }


@router.patch("/conversations/{conversation_id}", response_model=ConversationResponse)
def rename_conversation(
    conversation_id: int, payload: ConversationUpdate, db: Session = Depends(get_db)
) -> Conversation:
    conversation = _get_conversation_or_404(db, conversation_id)
    title = payload.title.strip() if payload.title else None
    if not title:
        raise AppError("ERR_VALIDATION", "Request validation failed", {"title": "must not be empty"})
    _validate_title(title)
    conversation.title = title
    db.commit()
    db.refresh(conversation)
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)) -> Response:
    conversation = _get_conversation_or_404(db, conversation_id)
    # Message rows cascade via the DB's ON DELETE CASCADE.
    db.delete(conversation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_message(conversation_id: int, payload: MessageCreate, db: Session = Depends(get_db)) -> Message:
    validate_against_schema({"q": payload.q}, ROOT / "schemas" / "query.json")
    conversation = _get_conversation_or_404(db, conversation_id)
    question = payload.q.strip()

    db.add(Message(conversation_id=conversation.id, role="user", text=question, created_at=_now()))

    project_id = None if payload.scope == "general" else conversation.project_id
    result = answer(question, db, project_id=project_id)

    assistant_message = Message(
        conversation_id=conversation.id,
        role="assistant",
        text=result["answer"] or result.get("suggestion") or "",
        citations=result["citations"],
        not_found=result["not_found"],
        created_at=_now(),
    )
    db.add(assistant_message)

    if not conversation.title:
        conversation.title = _auto_title(question)
    conversation.updated_at = assistant_message.created_at

    db.commit()
    db.refresh(assistant_message)
    return assistant_message

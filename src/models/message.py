from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[Any | None] = mapped_column(JSON)
    not_found: Mapped[bool | None] = mapped_column(Boolean)
    # Set on the assistant's reply only, from rag_service.answer()'s `complexity` field -
    # how hard the user's question (the preceding message) was judged to be.
    complexity_tier: Mapped[str | None] = mapped_column(String)
    complexity_score: Mapped[float | None] = mapped_column(Float)
    # What retrieval searched for, when that differs from the user's own words: a follow-up
    # is rewritten into a standalone question before it reaches FAISS. Null when the
    # question was searched as typed, which is the common case.
    search_query: Mapped[str | None] = mapped_column(Text)
    search_rewritten: Mapped[bool | None] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

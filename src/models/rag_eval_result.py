from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


class RagEvalResult(Base):
    __tablename__ = "rag_eval_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rag_eval_job_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("rag_eval_jobs.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String, nullable=False)
    difficulty: Mapped[str] = mapped_column(String, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    expected_answer: Mapped[str] = mapped_column(Text, nullable=False)
    actual_answer: Mapped[str | None] = mapped_column(Text)
    not_found: Mapped[bool] = mapped_column(Boolean, nullable=False)
    retrieval_hit: Mapped[bool] = mapped_column(Boolean, nullable=False)
    judge_verdict: Mapped[str | None] = mapped_column(String)
    judge_detail: Mapped[str | None] = mapped_column(Text)
    complexity_tier: Mapped[str | None] = mapped_column(String)
    complexity_score: Mapped[float | None] = mapped_column(Float)
    latency_s: Mapped[float | None] = mapped_column(Float)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    run_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

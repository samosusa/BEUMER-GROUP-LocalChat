from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


class RagEvalJob(Base):
    __tablename__ = "rag_eval_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    # Which file under data/eval/ this run answered questions from (see src/rag_eval.py) -
    # recorded so a later reader of /rag-eval/results knows what a run actually tested.
    dataset: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # Which answer model and embedding model were active when the run started - captured
    # automatically (see src/api/rag_eval.py start_rag_eval), not a run parameter a caller
    # chooses, so two historical runs can be told apart when comparing them side by side.
    answer_model: Mapped[str | None] = mapped_column(String)
    embedding_model: Mapped[str | None] = mapped_column(String)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_question: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)

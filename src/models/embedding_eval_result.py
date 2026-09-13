from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


class EmbeddingEvalResult(Base):
    __tablename__ = "embedding_eval_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    embedding_benchmark_job_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("embedding_benchmark_jobs.id", ondelete="CASCADE"), nullable=False
    )
    model: Mapped[str] = mapped_column(String, nullable=False)
    dimension: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    load_s: Mapped[float | None] = mapped_column(Float)
    text_label: Mapped[str | None] = mapped_column(String)
    text_count: Mapped[int | None] = mapped_column(Integer)
    embed_s: Mapped[float | None] = mapped_column(Float)
    texts_per_s: Mapped[float | None] = mapped_column(Float)
    peak_mem_mb: Mapped[float | None] = mapped_column(Float)
    run_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

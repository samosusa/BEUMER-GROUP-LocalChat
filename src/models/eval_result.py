from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


class EvalResult(Base):
    __tablename__ = "eval_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    benchmark_job_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("benchmark_jobs.id", ondelete="CASCADE"), nullable=False
    )
    model: Mapped[str] = mapped_column(String, nullable=False)
    device: Mapped[str] = mapped_column(String, nullable=False)
    device_name: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    load_s: Mapped[float | None] = mapped_column(Float)
    ttft_s: Mapped[float | None] = mapped_column(Float)
    gen_tokens: Mapped[int | None] = mapped_column(Integer)
    tok_s: Mapped[float | None] = mapped_column(Float)
    total_s: Mapped[float | None] = mapped_column(Float)
    peak_mem_mb: Mapped[float | None] = mapped_column(Float)
    peak_vram_mb: Mapped[float | None] = mapped_column(Float)
    question: Mapped[str | None] = mapped_column(Text)
    prompt_label: Mapped[str | None] = mapped_column(String)
    complexity_tier: Mapped[str | None] = mapped_column(String)
    complexity_score: Mapped[float | None] = mapped_column(Float)
    run_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


class VectorCapacityResult(Base):
    __tablename__ = "vector_capacity_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vector_capacity_job_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("vector_capacity_jobs.id", ondelete="CASCADE"), nullable=False
    )
    doc_count: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False)
    step_docs: Mapped[int] = mapped_column(Integer, nullable=False)
    step_s: Mapped[float] = mapped_column(Float, nullable=False)
    docs_per_s: Mapped[float | None] = mapped_column(Float)
    vector_dir_mb: Mapped[float] = mapped_column(Float, nullable=False)
    vector_file_count: Mapped[int] = mapped_column(Integer, nullable=False)
    db_size_mb: Mapped[float] = mapped_column(Float, nullable=False)
    rss_mb: Mapped[float] = mapped_column(Float, nullable=False)
    query_count: Mapped[int] = mapped_column(Integer, nullable=False)
    query_latency_ms_mean: Mapped[float | None] = mapped_column(Float)
    query_latency_ms_min: Mapped[float | None] = mapped_column(Float)
    query_latency_ms_max: Mapped[float | None] = mapped_column(Float)
    query_hits_mean: Mapped[float | None] = mapped_column(Float)
    run_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str] = mapped_column(String, nullable=False)
    checksum: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # NULL means the document belongs to the general corpus rather than one project.
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # True lets a project-scoped document also be surfaced in the general corpus, without a
    # second row/re-embedding - see src/retriever.py's general-visibility clause. Meaningless
    # (and always False) on a document that already has project_id IS NULL.
    also_general: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Set once ingestion has parsed the file's text (see src/ingest/pipeline.py); NULL
    # until then, and for documents registered via POST /docs without going through the
    # ingestion pipeline.
    complexity_tier: Mapped[str | None] = mapped_column(String)
    complexity_score: Mapped[float | None] = mapped_column(Float)
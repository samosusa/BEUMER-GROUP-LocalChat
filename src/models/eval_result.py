from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.db import Base


class EvalResult(Base):
    __tablename__ = "eval_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    top_k: Mapped[Any] = mapped_column(JSON, nullable=False)
    run_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
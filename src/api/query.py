from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api.projects import get_project_or_404
from src.db import get_db
from src.rag_service import answer
from src.validation import ROOT, validate_against_schema


router = APIRouter()


class QueryRequest(BaseModel):
    q: str | None = None
    project_id: int | None = None


@router.post("/query", status_code=status.HTTP_200_OK)
def query(payload: QueryRequest, db: Session = Depends(get_db)) -> dict:
    validate_against_schema({"q": payload.q}, ROOT / "schemas" / "query.json")
    if payload.project_id is not None:
        get_project_or_404(db, payload.project_id)
    return answer(payload.q.strip(), db, project_id=payload.project_id)
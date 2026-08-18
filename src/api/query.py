from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import get_db
from src.rag_service import answer


router = APIRouter()


class QueryRequest(BaseModel):
    q: str


@router.post("/query", status_code=status.HTTP_200_OK)
def query(payload: QueryRequest, db: Session = Depends(get_db)) -> dict:
    if not payload.q.strip():
        raise HTTPException(status_code=400, detail="q must not be empty")
    return answer(payload.q.strip(), db)
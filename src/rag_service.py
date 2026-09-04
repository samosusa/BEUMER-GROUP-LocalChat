from __future__ import annotations

from sqlalchemy.orm import Session

from src import llm_adapter
from src.retriever import RetrievedChunk, retrieve_chunks


MIN_SIMILARITY = 0.35
TOP_K = 5


def build_prompt(question: str, retrieved: list[RetrievedChunk]) -> str:
    context = "\n\n".join(
        f"[{index}] {item.document.title} | section: {item.chunk.section or 'Unknown'} | "
        f"page: {item.chunk.page or 'Unknown'}\n{item.chunk.text}"
        for index, item in enumerate(retrieved, start=1)
    )
    return (
        "You answer questions using only the provided documentation. "
        "If the documentation does not contain the answer, say that it is not available. "
        "Answer directly in plain prose: no source numbers, citations, or "
        "'Question:'/'Answer:' labels in your reply, since sources are already "
        "shown separately.\n\n"
        f"Documentation:\n{context}\n\nQuestion: {question}\nAnswer:"
    )


def answer(
    question: str,
    db: Session,
    top_k: int = TOP_K,
    project_id: int | None = None,
    include_general: bool = False,
) -> dict:
    retrieved = retrieve_chunks(
        question, db, top_k=top_k, project_id=project_id, include_general=include_general
    )
    if not retrieved or retrieved[0].score < MIN_SIMILARITY:
        return {
            "answer": None,
            "citations": [],
            "not_found": True,
            "suggestion": "Try a more specific question about the ingested project documentation.",
        }

    generated = llm_adapter.generate(build_prompt(question, retrieved), max_tokens=512)
    citations = [
        {
            "title": item.document.title,
            "section": item.chunk.section,
            "page": item.chunk.page,
            "score": item.score,
        }
        for item in retrieved
    ]
    return {"answer": generated, "citations": citations, "not_found": False}
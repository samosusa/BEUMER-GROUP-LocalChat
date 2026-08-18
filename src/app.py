from fastapi import FastAPI

from src.api.docs import router as docs_router
from src.api.ingest import router as ingest_router
from src.api.query import router as query_router
from src.llm_adapter import load_model


app = FastAPI(title="LocalChat")
app.include_router(docs_router)
app.include_router(ingest_router)
app.include_router(query_router)


@app.on_event("startup")
def preload_llm() -> None:
    try:
        load_model()
    except FileNotFoundError:
        # Development and retrieval-only tests may not have downloaded the local GGUF yet.
        pass


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
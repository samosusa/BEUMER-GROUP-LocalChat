from fastapi import FastAPI

from src.api.docs import router as docs_router
from src.api.ingest import router as ingest_router


app = FastAPI(title="LocalChat")
app.include_router(docs_router)
app.include_router(ingest_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
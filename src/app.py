from fastapi import FastAPI

from src.api.docs import router as docs_router


app = FastAPI(title="LocalChat")
app.include_router(docs_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
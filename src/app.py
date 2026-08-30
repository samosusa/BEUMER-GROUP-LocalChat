from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.api.docs import router as docs_router
from src.api.ingest import router as ingest_router
from src.api.query import router as query_router
from src.errors import (
    AppError,
    app_error_handler,
    http_exception_handler,
    request_validation_handler,
    unhandled_error_handler,
)
from src.llm_adapter import load_model


app = FastAPI(
    title="LocalChat",
    exception_handlers={
        AppError: app_error_handler,
        RequestValidationError: request_validation_handler,
        StarletteHTTPException: http_exception_handler,
        Exception: unhandled_error_handler,
    },
)
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
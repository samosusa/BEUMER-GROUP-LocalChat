import sys

# Python 3.10 or newer, checked before anything else is imported.
#
# The models and src/api/query.py annotate with PEP 604 unions (`str | None`) without
# `from __future__ import annotations`, so on 3.9 they are evaluated at class-body time and
# raise `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'` from inside
# SQLAlchemy - which reads as a broken dependency, not as a wrong interpreter. macOS still
# ships 3.9 as `python3`, so `python3 -m venv .venv` on a Mac lands there by default and the
# whole dependency tree installs happily before anything explains itself. The Dockerfile
# builds on 3.11; that is the version this targets.
if sys.version_info < (3, 10):
    raise RuntimeError(
        f"LocalChat needs Python 3.10 or newer (3.11 is what the Dockerfile uses); this is "
        f"{sys.version.split()[0]}. On macOS `python3` is often the system 3.9 - install a "
        f"newer one (`brew install python@3.12`) and rebuild the virtualenv with it."
    )

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.api.benchmark import router as benchmark_router
from src.api.conversations import router as conversations_router
from src.api.docs import router as docs_router
from src.api.embeddings import router as embeddings_router
from src.api.ingest import router as ingest_router
from src.api.models import router as models_router
from src.api.projects import router as projects_router
from src.api.query import router as query_router
from src.api.rag_eval import router as rag_eval_router
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
    # FastAPI's interactive Swagger UI defaults to GET /docs, which collides with
    # this app's own /docs document-management resource; move it out of the way.
    docs_url="/api-docs",
    exception_handlers={
        AppError: app_error_handler,
        RequestValidationError: request_validation_handler,
        StarletteHTTPException: http_exception_handler,
        Exception: unhandled_error_handler,
    },
)
app.include_router(benchmark_router)
app.include_router(conversations_router)
app.include_router(docs_router)
app.include_router(embeddings_router)
app.include_router(ingest_router)
app.include_router(models_router)
app.include_router(projects_router)
app.include_router(query_router)
app.include_router(rag_eval_router)


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
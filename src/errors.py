from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}
        self.status_code = status_code

    def body(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


async def app_error_handler(request: Request, error: AppError) -> JSONResponse:
    return JSONResponse(status_code=error.status_code, content=error.body())


async def request_validation_handler(request: Request, error: RequestValidationError) -> JSONResponse:
    details: dict[str, str] = {}
    missing_file = False
    for item in error.errors():
        location = item.get("loc", ())
        field = str(location[-1]) if location else "request"
        if field == "file" and item.get("type") == "missing":
            missing_file = True
        reason = item.get("msg", "Invalid value")
        details[field] = reason
    if missing_file:
        code = "ERR_MISSING_FILE"
        message = "An upload file is required"
        status_code = 400
    else:
        code = "ERR_VALIDATION"
        message = "Request validation failed"
        status_code = 400
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "details": details},
    )


async def http_exception_handler(request: Request, error: StarletteHTTPException) -> JSONResponse:
    code_by_status = {404: "ERR_NOT_FOUND", 405: "ERR_METHOD_NOT_ALLOWED"}
    code = code_by_status.get(error.status_code, "ERR_HTTP")
    message = error.detail if isinstance(error.detail, str) else "HTTP request failed"
    details = error.detail if isinstance(error.detail, dict) else {}
    return JSONResponse(
        status_code=error.status_code,
        content={"code": code, "message": message, "details": details},
    )


async def unhandled_error_handler(request: Request, error: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "code": "ERR_INTERNAL",
            "message": "An unexpected error occurred",
            "details": {},
        },
    )
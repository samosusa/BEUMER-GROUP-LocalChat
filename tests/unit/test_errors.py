from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.errors import AppError, app_error_handler


def test_app_error_has_standard_json_shape_and_status():
    test_app = FastAPI(exception_handlers={AppError: app_error_handler})

    @test_app.get("/failure")
    def failure():
        raise AppError("ERR_DUPLICATE_DOCUMENT", "Already exists", {"checksum": "abc"}, status_code=409)

    response = TestClient(test_app).get("/failure")

    assert response.status_code == 409
    assert response.json() == {
        "code": "ERR_DUPLICATE_DOCUMENT",
        "message": "Already exists",
        "details": {"checksum": "abc"},
    }
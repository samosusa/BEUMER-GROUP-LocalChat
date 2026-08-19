from fastapi.testclient import TestClient

from src.app import app


client = TestClient(app)


def test_nonexistent_job_returns_not_found():
    response = client.get("/status/999999999")

    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_non_integer_job_id_returns_validation_error():
    response = client.get("/status/abc")

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"
    assert "job_id" in response.json()["details"]
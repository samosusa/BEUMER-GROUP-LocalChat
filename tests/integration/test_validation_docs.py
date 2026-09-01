from pathlib import Path

from fastapi.testclient import TestClient

from src.app import app


client = TestClient(app)


def test_empty_title_returns_validation_error(tmp_path: Path):
    path = tmp_path / "guide.txt"
    path.write_text("guide", encoding="utf-8")

    response = client.post("/docs", json={"title": "   ", "path": str(path)})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"
    assert response.json()["details"]["title"] == "must not be empty"


def test_missing_document_path_returns_structured_error():
    response = client.post("/docs", json={"title": "Missing", "path": "missing-file.txt"})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_FILE_NOT_FOUND"
    assert set(response.json()) == {"code", "message", "details"}


def test_duplicate_checksum_returns_conflict(tmp_path: Path):
    path = tmp_path / "duplicate.txt"
    path.write_text(f"unique duplicate content {tmp_path}", encoding="utf-8")
    first = client.post("/docs", json={"title": "First", "path": str(path)})
    second = client.post("/docs", json={"title": "Second", "path": str(path)})

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["code"] == "ERR_DUPLICATE_DOCUMENT"
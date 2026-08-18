from pathlib import Path

from fastapi.testclient import TestClient

from src.app import app


client = TestClient(app)


def test_create_read_delete_document(tmp_path: Path):
    document_path = tmp_path / "guide.txt"
    document_path.write_text("LocalChat documentation", encoding="utf-8")

    response = client.post("/docs", json={"title": "Guide", "path": str(document_path)})
    assert response.status_code == 201
    created = response.json()
    assert created["title"] == "Guide"
    assert created["path"] == str(document_path)
    assert len(created["checksum"]) == 64

    read_response = client.get(f"/docs/{created['id']}")
    assert read_response.status_code == 200
    assert read_response.json() == created

    delete_response = client.delete(f"/docs/{created['id']}")
    assert delete_response.status_code == 204
    assert client.get(f"/docs/{created['id']}").status_code == 404


def test_missing_document_returns_404():
    assert client.get("/docs/999999").status_code == 404


def test_create_missing_file_returns_400():
    response = client.post("/docs", json={"title": "Missing", "path": "does-not-exist.txt"})
    assert response.status_code == 400
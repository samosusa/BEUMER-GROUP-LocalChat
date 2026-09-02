from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.models.document import Document
from src.models.project import Project


client = TestClient(app)


def test_create_get_delete_project():
    response = client.post("/projects", json={"name": "Conveyor line"})
    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Conveyor line"
    assert created["created_at"] == created["updated_at"]

    get_response = client.get(f"/projects/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json() == created

    delete_response = client.delete(f"/projects/{created['id']}")
    assert delete_response.status_code == 204
    assert client.get(f"/projects/{created['id']}").status_code == 404


def test_create_project_rejects_empty_name():
    response = client.post("/projects", json={"name": "   "})
    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"


def test_list_projects_includes_created_project():
    created = client.post("/projects", json={"name": "Listed project"}).json()

    try:
        list_response = client.get("/projects")
        assert list_response.status_code == 200
        ids = [project["id"] for project in list_response.json()]
        assert created["id"] in ids
    finally:
        client.delete(f"/projects/{created['id']}")


def test_missing_project_returns_404():
    assert client.get("/projects/999999").status_code == 404
    assert client.delete("/projects/999999").status_code == 404
    assert client.patch("/projects/999999", json={"name": "x"}).status_code == 404


def test_rename_project():
    created = client.post("/projects", json={"name": "Old name"}).json()

    try:
        rename_response = client.patch(f"/projects/{created['id']}", json={"name": "New name"})
        assert rename_response.status_code == 200
        assert rename_response.json()["name"] == "New name"

        empty_response = client.patch(f"/projects/{created['id']}", json={"name": "   "})
        assert empty_response.status_code == 400
    finally:
        client.delete(f"/projects/{created['id']}")


def test_delete_project_cascades_documents():
    """A deleted project must take its documents with it, so a general-corpus query never
    surfaces a document from a project the user believes was removed."""
    created = client.post("/projects", json={"name": "Cascade project"}).json()

    with SessionLocal() as db:
        from datetime import datetime

        document = Document(
            title="Scoped doc",
            path="scoped.txt",
            checksum="scoped-checksum",
            version=1,
            project_id=created["id"],
            uploaded_at=datetime.utcnow(),
        )
        db.add(document)
        db.commit()
        document_id = document.id

    delete_response = client.delete(f"/projects/{created['id']}")
    assert delete_response.status_code == 204

    with SessionLocal() as db:
        assert db.get(Project, created["id"]) is None
        assert db.get(Document, document_id) is None

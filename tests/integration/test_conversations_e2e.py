from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.models.conversation import Conversation
from src.models.message import Message


client = TestClient(app)


def _fake_answer(monkeypatch, result: dict):
    import src.api.conversations as conversations_api

    monkeypatch.setattr(conversations_api, "answer", lambda question, db, project_id=None: result)


def test_create_get_delete_conversation():
    response = client.post("/conversations", json={"title": "Conveyor questions"})
    assert response.status_code == 201
    created = response.json()
    assert created["title"] == "Conveyor questions"
    assert created["created_at"] == created["updated_at"]

    get_response = client.get(f"/conversations/{created['id']}")
    assert get_response.status_code == 200
    detail = get_response.json()
    assert detail["title"] == "Conveyor questions"
    assert detail["messages"] == []

    delete_response = client.delete(f"/conversations/{created['id']}")
    assert delete_response.status_code == 204
    assert client.get(f"/conversations/{created['id']}").status_code == 404


def test_list_conversations_includes_created_conversation():
    created = client.post("/conversations", json={"title": "Listed thread"}).json()

    try:
        list_response = client.get("/conversations")
        assert list_response.status_code == 200
        ids = [conversation["id"] for conversation in list_response.json()]
        assert created["id"] in ids
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_missing_conversation_returns_404():
    assert client.get("/conversations/999999").status_code == 404
    assert client.delete("/conversations/999999").status_code == 404
    assert client.patch("/conversations/999999", json={"title": "x"}).status_code == 404
    assert client.post("/conversations/999999/messages", json={"q": "hello"}).status_code == 404


def test_rename_conversation():
    created = client.post("/conversations", json={}).json()
    assert created["title"] is None

    try:
        rename_response = client.patch(f"/conversations/{created['id']}", json={"title": "Safety questions"})
        assert rename_response.status_code == 200
        assert rename_response.json()["title"] == "Safety questions"

        empty_response = client.patch(f"/conversations/{created['id']}", json={"title": "   "})
        assert empty_response.status_code == 400
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_post_message_persists_qa_pair_and_auto_titles(monkeypatch):
    """A question/answer pair posted into a conversation must show up as two rows
    (user then assistant) sharing that conversation, with the title auto-generated
    from the first question when the conversation started untitled."""
    _fake_answer(
        monkeypatch,
        {
            "answer": "The conveyor speed is 2 meters per second.",
            "citations": [{"title": "Guide", "section": "Speed", "page": 1, "score": 0.9}],
            "not_found": False,
        },
    )

    created = client.post("/conversations", json={}).json()

    try:
        response = client.post(
            f"/conversations/{created['id']}/messages", json={"q": "What is the conveyor speed?"}
        )
        assert response.status_code == 201
        assistant_message = response.json()
        assert assistant_message["role"] == "assistant"
        assert assistant_message["text"] == "The conveyor speed is 2 meters per second."
        assert assistant_message["not_found"] is False
        assert assistant_message["citations"][0]["title"] == "Guide"

        detail = client.get(f"/conversations/{created['id']}").json()
        assert detail["title"] == "What is the conveyor speed?"
        assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
        assert detail["messages"][0]["text"] == "What is the conveyor speed?"
        assert detail["messages"][0]["citations"] is None
        assert detail["updated_at"] > detail["created_at"]
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_post_message_keeps_explicit_title_and_handles_not_found(monkeypatch):
    _fake_answer(
        monkeypatch,
        {
            "answer": None,
            "citations": [],
            "not_found": True,
            "suggestion": "Try a more specific question.",
        },
    )

    created = client.post("/conversations", json={"title": "Pinned title"}).json()

    try:
        response = client.post(f"/conversations/{created['id']}/messages", json={"q": "Unrelated question"})
        assert response.status_code == 201
        assistant_message = response.json()
        assert assistant_message["not_found"] is True
        assert assistant_message["citations"] == []
        assert assistant_message["text"] == "Try a more specific question."

        detail = client.get(f"/conversations/{created['id']}").json()
        assert detail["title"] == "Pinned title"
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_post_message_rejects_blank_question():
    created = client.post("/conversations", json={}).json()

    try:
        response = client.post(f"/conversations/{created['id']}/messages", json={"q": ""})
        assert response.status_code == 400
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_create_conversation_rejects_unknown_project():
    response = client.post("/conversations", json={"title": "Orphan", "project_id": 999999})
    assert response.status_code == 404
    assert response.json()["code"] == "ERR_NOT_FOUND"


def test_post_message_scopes_retrieval_to_the_conversations_project(monkeypatch):
    import src.api.conversations as conversations_api

    project = client.post("/projects", json={"name": "Scoped chat project"}).json()

    captured_project_ids = []

    def fake_answer(question, db, project_id=None):
        captured_project_ids.append(project_id)
        return {"answer": "answer", "citations": [], "not_found": False}

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={"project_id": project["id"]}).json()
    assert created["project_id"] == project["id"]

    try:
        response = client.post(f"/conversations/{created['id']}/messages", json={"q": "Any question?"})
        assert response.status_code == 201
        assert captured_project_ids == [project["id"]]
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_delete_conversation_cascades_messages(monkeypatch):
    _fake_answer(monkeypatch, {"answer": "An answer.", "citations": [], "not_found": False})

    created = client.post("/conversations", json={}).json()
    client.post(f"/conversations/{created['id']}/messages", json={"q": "Any question?"})

    with SessionLocal() as db:
        assert db.query(Message).filter_by(conversation_id=created["id"]).count() == 2

    delete_response = client.delete(f"/conversations/{created['id']}")
    assert delete_response.status_code == 204

    with SessionLocal() as db:
        assert db.get(Conversation, created["id"]) is None
        assert db.query(Message).filter_by(conversation_id=created["id"]).count() == 0

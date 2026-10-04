from fastapi.testclient import TestClient

from src.app import app
from src.db import SessionLocal
from src.models.conversation import Conversation
from src.models.message import Message

client = TestClient(app)


def _fake_answer(monkeypatch, result: dict):
    import src.api.conversations as conversations_api

    monkeypatch.setattr(
        conversations_api,
        "answer",
        lambda question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None: result,
    )


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


def test_post_message_surfaces_question_complexity(monkeypatch):
    _fake_answer(
        monkeypatch,
        {
            "answer": "The conveyor speed is 2 meters per second.",
            "citations": [],
            "not_found": False,
            "complexity": {"tier": "moderate", "score": 0.3},
        },
    )

    created = client.post("/conversations", json={}).json()

    try:
        response = client.post(
            f"/conversations/{created['id']}/messages", json={"q": "What is the conveyor speed?"}
        )
        assert response.status_code == 201
        assistant_message = response.json()
        assert assistant_message["complexity_tier"] == "moderate"
        assert assistant_message["complexity_score"] == 0.3
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

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
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


def test_post_message_scope_general_overrides_the_conversations_project(monkeypatch):
    """Picking 'General' in the client for a project-linked chat must search the
    project-less corpus for that turn, not silently keep using the chat's own project."""
    import src.api.conversations as conversations_api

    project = client.post("/projects", json={"name": "Overridable project"}).json()

    captured_project_ids = []

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
        captured_project_ids.append(project_id)
        return {"answer": "answer", "citations": [], "not_found": False}

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={"project_id": project["id"]}).json()

    try:
        response = client.post(
            f"/conversations/{created['id']}/messages",
            json={"q": "Any question?", "scope": "general"},
        )
        assert response.status_code == 201
        assert captured_project_ids == [None]
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_post_message_scope_both_keeps_project_and_adds_general(monkeypatch):
    """Picking 'Both' for a project-linked chat must keep searching that project's
    documents while also drawing on the project-less general corpus."""
    import src.api.conversations as conversations_api

    project = client.post("/projects", json={"name": "Both-scope project"}).json()

    captured = []

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
        captured.append((project_id, include_general))
        return {"answer": "answer", "citations": [], "not_found": False}

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={"project_id": project["id"]}).json()

    try:
        response = client.post(
            f"/conversations/{created['id']}/messages",
            json={"q": "Any question?", "scope": "both"},
        )
        assert response.status_code == 201
        assert captured == [(project["id"], True)]
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_post_message_scope_both_without_a_project_is_plain_general(monkeypatch):
    """'Both' only makes sense with a project to add to; for a project-less conversation
    it must behave exactly like the plain general corpus search."""
    import src.api.conversations as conversations_api

    captured = []

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
        captured.append((project_id, include_general))
        return {"answer": "answer", "citations": [], "not_found": False}

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={}).json()

    try:
        response = client.post(
            f"/conversations/{created['id']}/messages",
            json={"q": "Any question?", "scope": "both"},
        )
        assert response.status_code == 201
        assert captured == [(None, False)]
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


def test_post_message_passes_prior_turn_as_history_to_answer(monkeypatch):
    """The Samo Susa scenario: "Is Samo Susa 20 years old?" followed by "What are his
    hobbies?" must reach rag_service.answer() with the first Q/A pair as history, so it
    can widen retrieval and resolve "his" - not as two turns with no link between them."""
    import src.api.conversations as conversations_api

    captured_history = []

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
        captured_history.append(history)
        if question == "Is Samo Susa 20 years old?":
            return {"answer": "Yes, Samo Susa is 20 years old.", "citations": [], "not_found": False}
        return {"answer": "His hobbies are hiking and chess.", "citations": [], "not_found": False}

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={}).json()

    try:
        first = client.post(
            f"/conversations/{created['id']}/messages", json={"q": "Is Samo Susa 20 years old?"}
        )
        assert first.status_code == 201

        second = client.post(f"/conversations/{created['id']}/messages", json={"q": "What are his hobbies?"})
        assert second.status_code == 201

        assert captured_history[0] == []
        assert captured_history[1] == [("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")]
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_post_message_use_history_false_opts_out_of_conversation_context(monkeypatch):
    """A turn that deliberately changes subject can skip history so a stale entity from an
    earlier question doesn't leak into this turn's retrieval or generation."""
    import src.api.conversations as conversations_api

    captured_history = []

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
        captured_history.append(history)
        return {"answer": "answer", "citations": [], "not_found": False}

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={}).json()

    try:
        first = client.post(
            f"/conversations/{created['id']}/messages", json={"q": "Is Samo Susa 20 years old?"}
        )
        assert first.status_code == 201

        second = client.post(
            f"/conversations/{created['id']}/messages",
            json={"q": "What are the conveyor speed limits?", "use_history": False},
        )
        assert second.status_code == 201

        assert captured_history == [[], []]
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_post_message_keeps_the_question_but_not_the_refusal_of_a_turn_that_found_nothing(monkeypatch):
    """The cat scenario: a refusal from an earlier turn - flagged not_found, or stored before
    refusals were flagged and only recognisable by its text - must not reach the next turn's
    history. A small model copies "I don't have any information about a cat." onto the next
    question even once the scope widens to Both and the cat document is retrieved first. The
    question stays: it is what "how is it doing now?" refers to."""
    import src.api.conversations as conversations_api

    captured_history = []
    replies = {
        "How often is the forklift inspected?": {"answer": "Before every shift.", "citations": [], "not_found": False},
        "Is there a spill kit near the chargers?": {"answer": None, "suggestion": "Try again.", "citations": [], "not_found": True},
        "Who refills it?": {"answer": "I don't have any information about a spill kit.", "citations": [], "not_found": False},
        "What is the yard speed limit?": {"answer": "15 km/h.", "citations": [], "not_found": False},
    }

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
        captured_history.append(history)
        return replies[question]

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={}).json()

    try:
        for question in replies:
            response = client.post(f"/conversations/{created['id']}/messages", json={"q": question})
            assert response.status_code == 201

        assert captured_history[-1] == [
            ("How often is the forklift inspected?", "Before every shift."),
            ("Is there a spill kit near the chargers?", ""),
            ("Who refills it?", ""),
        ]
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_history_carries_the_standalone_question_that_was_searched(monkeypatch):
    """After a few "it"/"its" follow-ups, the turn that named the machine has left the
    HISTORY_TURNS window. Each follow-up's standalone rewrite - what retrieval actually
    searched - still names it, so that is what the history keeps."""
    import src.api.conversations as conversations_api

    captured_history = []

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
        captured_history.append(history)
        if question == "What is its rated load?":
            return {
                "answer": "5 tonnes.", "citations": [], "not_found": False,
                "search": {"query": "What is the crane's rated load?", "rewritten": True, "reason": "rewritten"},
            }
        return {"answer": "answer", "citations": [], "not_found": False}

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={}).json()

    try:
        for question in ("Who may operate the crane?", "What is its rated load?", "And its lifting height?"):
            response = client.post(f"/conversations/{created['id']}/messages", json={"q": question})
            assert response.status_code == 201

        assert captured_history[-1] == [
            ("Who may operate the crane?", "answer"),
            ("What is the crane's rated load?", "5 tonnes."),
        ]
    finally:
        client.delete(f"/conversations/{created['id']}")


def test_a_follow_up_is_focused_on_the_document_the_previous_answer_came_from(monkeypatch):
    """The previous answer's top source is passed on, so a follow-up can keep it in the
    evidence. A turn that found nothing has no source - and leaves nothing to focus on."""
    import src.api.conversations as conversations_api

    captured_focus = []
    replies = iter([
        {"answer": "Before every shift.", "not_found": False,
         "citations": [{"doc_id": 7, "title": "Forklift manual", "section": None, "page": 1, "score": 0.8},
                       {"doc_id": 9, "title": "Maintenance plan", "section": None, "page": 2, "score": 0.6}]},
        {"answer": "48 V.", "not_found": False,
         "citations": [{"doc_id": 7, "title": "Forklift manual", "section": None, "page": 3, "score": 0.7}]},
        {"answer": None, "suggestion": "Try again.", "citations": [], "not_found": True},
        {"answer": "answer", "citations": [], "not_found": False},
    ])

    def fake_answer(question, db, project_id=None, include_general=False, history=None, focus_doc_ids=None):
        captured_focus.append(focus_doc_ids)
        return next(replies)

    monkeypatch.setattr(conversations_api, "answer", fake_answer)

    created = client.post("/conversations", json={}).json()

    try:
        for question in ("How often is the forklift inspected?", "And its battery voltage?",
                         "Where is the spill kit?", "Who refills it?"):
            response = client.post(f"/conversations/{created['id']}/messages", json={"q": question})
            assert response.status_code == 201

        assert captured_focus == [[], [7], [7], []]
    finally:
        client.delete(f"/conversations/{created['id']}")

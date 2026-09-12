from fastapi.testclient import TestClient

from src.app import app


client = TestClient(app)


def test_missing_file_returns_structured_error():
    response = client.post("/ingest", data={"title": "Guide"})

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_MISSING_FILE"


def test_empty_title_returns_validation_error():
    response = client.post(
        "/ingest",
        data={"title": "   "},
        files={"file": ("guide.txt", b"guide", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_VALIDATION"
    assert response.json()["details"]["title"] == "must not be empty"


def test_unsupported_extension_returns_format_error():
    response = client.post(
        "/ingest",
        data={"title": "Executable"},
        files={"file": ("program.exe", b"MZ", "application/octet-stream")},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "ERR_UNSUPPORTED_FORMAT"


def test_corrupt_pdf_returns_parse_error():
    response = client.post(
        "/ingest",
        data={"title": "Corrupt PDF"},
        files={"file": ("broken.pdf", b"not a PDF", "application/pdf")},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "ERR_PARSE_FAILED"


def test_whitespace_only_file_returns_no_extractable_text_error():
    response = client.post(
        "/ingest",
        data={"title": "Blank"},
        files={"file": ("blank.txt", b"   \n\t\n   ", "text/plain")},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "ERR_NO_EXTRACTABLE_TEXT"
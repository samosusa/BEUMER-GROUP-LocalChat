"""Session-wide test isolation.

Without this, integration tests that build a `TestClient(app)` at module scope (most of
`tests/integration/`) fall through to `src.db`'s default `DATABASE_URL` and
`FaissVectorStore`'s default `LOCALCHAT_VECTOR_DIR` - both of which point at the real
development state in `data/app.db` and `data/vectors/`. Tests that create a `Project` for
scoping (e.g. "Project A", "Scoped project") but only clean up the conversation/document
they attach to it then leave that project behind permanently, in the same database the
live app reads from.

Pointing both at a fresh temp location - set here, before any test module gets a chance to
`import src.db` or `import src.app` - keeps every test run's state disposable, the same way
`tests/integration/test_real_workflow_e2e.py` already isolates itself individually. This
module must set the environment variables at import time (not inside a fixture): pytest
imports `conftest.py` before collecting any test module, which is what makes the ordering
guarantee here hold.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_STATE_DIR = Path(tempfile.mkdtemp(prefix="localchat-tests-"))
os.environ.setdefault("LOCALCHAT_DATABASE_URL", f"sqlite:///{_STATE_DIR / 'test.db'}")
os.environ.setdefault("LOCALCHAT_VECTOR_DIR", str(_STATE_DIR / "vectors"))

import pytest

from src.db import Base, engine


@pytest.fixture(scope="session", autouse=True)
def _isolated_schema():
    Base.metadata.create_all(engine)
    yield

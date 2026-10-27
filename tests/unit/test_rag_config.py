import pytest

from src import rag_config
from src.rag_config import RagSettings


def test_defaults_are_the_improved_pipeline():
    settings = RagSettings()
    assert (settings.history_mode, settings.fusion, settings.hybrid, settings.selection) == (
        "compact", "rrf", True, "adaptive",
    )
    assert (settings.candidate_pool, settings.relative_cutoff, settings.min_chunks, settings.max_chunks) == (
        10, 0.85, 2, 8,
    )


def test_override_is_temporary():
    before = rag_config.get()
    with rag_config.override(fusion="fallback", hybrid=False) as settings:
        assert rag_config.get() is settings
        assert (settings.fusion, settings.hybrid) == ("fallback", False)
    assert rag_config.get() is before


def test_override_restores_settings_even_when_the_body_fails():
    before = rag_config.get()
    with pytest.raises(RuntimeError):
        with rag_config.override(selection="tiered"):
            raise RuntimeError("boom")
    assert rag_config.get() is before


@pytest.mark.parametrize(
    "changes",
    [
        {"history_mode": "verbatim"},
        {"fusion": "concat"},
        {"selection": "random"},
        {"relative_cutoff": 0},
        {"min_chunks": 9, "max_chunks": 8},
        {"max_chunks": 11},
    ],
)
def test_invalid_settings_are_rejected(changes):
    with pytest.raises(ValueError):
        RagSettings(**changes)


def test_environment_variables_set_the_process_defaults(monkeypatch):
    monkeypatch.setenv("LOCALCHAT_FUSION", "fallback")
    monkeypatch.setenv("LOCALCHAT_HYBRID", "false")
    settings = rag_config._from_env()
    assert settings.fusion == "fallback"
    assert settings.hybrid is False

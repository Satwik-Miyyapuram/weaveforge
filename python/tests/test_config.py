"""Settings: env vars first, then the token file the desktop app writes on Connect."""

import json

import pytest

from weaveforge.config import ConfigError, Settings


@pytest.fixture
def clean_env(monkeypatch, tmp_path):
    for name in (
        "WEAVEFORGE_TOKEN",
        "WEAVEFORGE_API_TOKEN",
        "WEAVEFORGE_API_URL",
        "WEAVEFORGE_PROJECT",
        "WEAVEFORGE_PROJECT_ID",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("WEAVEFORGE_MCP_FILE", str(tmp_path / "mcp.json"))
    return tmp_path / "mcp.json"


def test_env_wins(clean_env, monkeypatch):
    clean_env.write_text(json.dumps({"url": "http://127.0.0.1:27123/mcp", "token": "file"}))
    monkeypatch.setenv("WEAVEFORGE_TOKEN", "env")
    monkeypatch.setenv("WEAVEFORGE_API_URL", "https://example.org")
    s = Settings.from_env()
    assert (s.token, s.api_url) == ("env", "https://example.org")


def test_reads_desktop_token_file(clean_env, monkeypatch):
    clean_env.write_text(json.dumps({"url": "http://127.0.0.1:27123/mcp", "token": "wf_x"}))
    monkeypatch.setenv("WEAVEFORGE_PROJECT", "Thesis")
    s = Settings.from_env()
    assert (s.token, s.api_url, s.project_name) == ("wf_x", "http://127.0.0.1:27123", "Thesis")


def test_api_url_field_wins_over_mcp_url(clean_env):
    clean_env.write_text(
        json.dumps({"url": "http://127.0.0.1:1/mcp", "apiUrl": "http://127.0.0.1:2", "token": "t"})
    )
    assert Settings.from_env().api_url == "http://127.0.0.1:2"


def test_file_token_never_goes_to_another_host(clean_env, monkeypatch):
    clean_env.write_text(json.dumps({"url": "http://127.0.0.1:27123/mcp", "token": "wf_x"}))
    monkeypatch.setenv("WEAVEFORGE_API_URL", "https://example.org")
    with pytest.raises(ConfigError):
        Settings.from_env()


def test_missing_everything_raises(clean_env):
    with pytest.raises(ConfigError, match="Connect"):
        Settings.from_env()

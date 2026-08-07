"""Integration tests against the WeaveForge HTTP SDK (/api/sdk/*).

Skipped unless WEAVEFORGE_TOKEN and WEAVEFORGE_API_URL are set.
When WEAVEFORGE_TEST_USER_EMAIL is set (e.g. c@example.com), whoami must
match that account.
"""

from __future__ import annotations

import os
import uuid

import pytest

from weaveforge.config import ConfigError, Settings


def _settings_or_skip() -> Settings:
    try:
        return Settings.from_env()
    except ConfigError as exc:
        pytest.skip(str(exc))


@pytest.fixture(scope="module")
def container():
    _settings_or_skip()
    from weaveforge.container import connect

    return connect()


def test_whoami_matches_expected_account(container):
    expected = os.environ.get("WEAVEFORGE_TEST_USER_EMAIL", "").strip().lower()
    if not expected:
        pytest.skip("Set WEAVEFORGE_TEST_USER_EMAIL to assert account identity.")

    who = container.api.get("/api/sdk/whoami")
    assert who.get("userId") == container.user_id
    assert (who.get("email") or "").lower() == expected


def test_artifact_upload(container):
    from weaveforge import NewExperimentInput

    uc = container.manage_experiment
    exp = uc.add(NewExperimentInput(name=f"itest-art-{uuid.uuid4().hex[:8]}"))
    try:
        url = container.artifacts.upload(
            exp.id, "note.txt", b"hello from sdk", content_type="text/plain"
        )
        assert isinstance(url, str) and url
        updated = uc.add_artifacts(exp.id, [url])
        assert url in updated.artifacts
    finally:
        uc.remove(exp.id)

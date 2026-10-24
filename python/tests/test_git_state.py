"""The git remote recorded on a run (43-03)."""

import pytest

from weaveforge.features.experiments.application.git import _normalize_remote


@pytest.mark.parametrize(
    "raw, want",
    [
        # A token in an https remote must never reach the server.
        ("https://user:ghp_secret@github.com/a/b.git", "https://github.com/a/b"),
        ("https://x-access-token:tok@github.com/a/b", "https://github.com/a/b"),
        ("https://user@gitlab.com/a/b.git", "https://gitlab.com/a/b"),
        ("http://user:pw@host:8080/r.git", "http://host:8080/r"),
        # Already clean, or not http(s): unchanged apart from the existing rules.
        ("https://github.com/a/b.git", "https://github.com/a/b"),
        ("git@github.com:a/b.git", "https://github.com/a/b"),
        ("  https://github.com/a/b  ", "https://github.com/a/b"),
        ("ssh://git@host/r.git", "ssh://git@host/r"),
        ("", None),
        (None, None),
    ],
)
def test_normalize_remote(raw, want):
    assert _normalize_remote(raw) == want

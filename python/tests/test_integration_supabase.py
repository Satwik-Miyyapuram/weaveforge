"""Legacy integration tests — superseded by test_integration_api.py.

The Python SDK now talks to /api/sdk/* over HTTP. These tests remain for
environments that still wire Supabase adapters directly (not the default).
"""

from __future__ import annotations

import importlib.util

import pytest

from weaveforge.config import ConfigError, Settings

_HAS_SUPABASE = importlib.util.find_spec("supabase") is not None


def _settings_or_skip() -> Settings:
    try:
        return Settings.from_env()
    except ConfigError as exc:
        pytest.skip(str(exc))


pytestmark = [
    pytest.mark.skip(reason="Use tests/test_integration_api.py for HTTP SDK tests."),
    pytest.mark.skipif(not _HAS_SUPABASE, reason="supabase package not installed"),
]

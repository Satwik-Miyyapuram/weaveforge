"""Environment-driven configuration for the SDK.

The SDK talks to the WeaveForge web app over HTTP using a single bearer
token (copied from the dashboard) so users don't need to paste Supabase URL /
keys into their training environment.

Kept separate from ``container.py`` so wiring stays a pure function of a
``Settings`` object.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

_PROJECT_VARS = ("WEAVEFORGE_PROJECT_ID",)
_PROJECT_NAME_VARS = ("WEAVEFORGE_PROJECT",)
_TOKEN_VARS = ("WEAVEFORGE_TOKEN", "WEAVEFORGE_API_TOKEN")
_API_URL_VARS = ("WEAVEFORGE_API_URL",)
_MCP_FILE_VAR = "WEAVEFORGE_MCP_FILE"


class ConfigError(RuntimeError):
    pass


def _first(names: tuple[str, ...]) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def _desktop_connection() -> tuple[str, str] | None:
    """(api_url, token) from the file WeaveForge desktop writes on Connect, if any."""
    path = Path(os.environ.get(_MCP_FILE_VAR) or Path.home() / ".weaveforge" / "mcp.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    token = data.get("token") if isinstance(data, dict) else None
    url = data.get("apiUrl") or str(data.get("url") or "").removesuffix("/mcp")
    if not isinstance(token, str) or not token or not isinstance(url, str) or not url:
        return None
    return url.rstrip("/"), token


@dataclass
class Settings:
    api_url: str
    token: str
    #: Optional active project to scope experiments to (matches the web app's
    #: project switcher). ``None`` = the user's default/unscoped rows.
    project_id: str | None = None
    #: Optional project *name*, resolved to an id at connect time when
    #: ``project_id`` isn't given — friendlier than hunting for a UUID.
    project_name: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        api_url = _first(_API_URL_VARS)
        token = _first(_TOKEN_VARS)
        if not token:
            local = _desktop_connection()
            # The desktop token only ever goes to the desktop app's own address.
            if local and (not api_url or api_url.rstrip("/") == local[0]):
                api_url, token = local
        missing = [
            label
            for label, value in (
                ("WEAVEFORGE_TOKEN", token),
                ("WEAVEFORGE_API_URL", api_url),
            )
            if not value
        ]
        if missing:
            raise ConfigError(
                "Missing required environment variables: "
                + ", ".join(missing)
                + ". Press Connect in WeaveForge (Settings → AI & MCP), or set them to a"
                " token from Settings → Access tokens (see python/README.md)."
            )
        return cls(
            api_url=api_url,  # type: ignore[arg-type]
            token=token,  # type: ignore[arg-type]
            project_id=_first(_PROJECT_VARS),
            project_name=_first(_PROJECT_NAME_VARS),
        )

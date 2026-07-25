"""Environment-driven configuration for the SDK.

The SDK talks to the Thesis Tracker web app over HTTP using a single bearer
token (copied from the dashboard) so users don't need to paste Supabase URL /
keys into their training environment.

Kept separate from ``container.py`` so wiring stays a pure function of a
``Settings`` object.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

_PROJECT_VARS = ("THESIS_TRACKER_PROJECT_ID",)
_PROJECT_NAME_VARS = ("THESIS_TRACKER_PROJECT",)
_TOKEN_VARS = ("THESIS_TRACKER_TOKEN", "THESIS_TRACKER_API_TOKEN")
_API_URL_VARS = ("THESIS_TRACKER_API_URL",)


class ConfigError(RuntimeError):
    pass


def _first(names: tuple[str, ...]) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


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
        missing = [
            label
            for label, value in (
                ("THESIS_TRACKER_TOKEN", token),
                ("THESIS_TRACKER_API_URL", api_url),
            )
            if not value
        ]
        if missing:
            raise ConfigError(
                "Missing required environment variables: "
                + ", ".join(missing)
                + ". Set it to the dashboard-issued bearer token (see python/README.md)."
            )
        return cls(
            api_url=api_url,  # type: ignore[arg-type]
            token=token,  # type: ignore[arg-type]
            project_id=_first(_PROJECT_VARS),
            project_name=_first(_PROJECT_NAME_VARS),
        )

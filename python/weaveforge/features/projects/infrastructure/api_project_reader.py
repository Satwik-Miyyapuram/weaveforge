from __future__ import annotations

import httpx

from ....infrastructure.api_client import ApiClient
from ...projects.domain.project_reader import IProjectReader


class ProjectLookupMovedError(RuntimeError):
    """The server no longer resolves project names: projects live in workspace files.

    The relay answers 410 on ``/api/sdk/projects`` from 0.9.8. The SDK cannot
    read the workspace, so the caller must pass the project id directly.
    """


class ApiProjectReader(IProjectReader):
    def __init__(self, api: ApiClient) -> None:
        self._api = api

    def id_by_name(self, name: str) -> str | None:
        try:
            res = self._api.get("/api/sdk/projects", params={"name": name})
        except httpx.HTTPStatusError as err:
            if err.response.status_code == 410:
                raise ProjectLookupMovedError(
                    f'Cannot look up project "{name}" by name: projects moved to '
                    "your workspace files. Set WEAVEFORGE_PROJECT_ID to the "
                    "project's id instead."
                ) from err
            raise
        return res.get("projectId")

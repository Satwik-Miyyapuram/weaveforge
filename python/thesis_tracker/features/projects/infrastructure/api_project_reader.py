from __future__ import annotations

from ....infrastructure.api_client import ApiClient
from ...projects.domain.project_reader import IProjectReader


class ApiProjectReader(IProjectReader):
    def __init__(self, api: ApiClient) -> None:
        self._api = api

    def id_by_name(self, name: str) -> str | None:
        res = self._api.get("/api/sdk/projects", params={"name": name})
        return res.get("projectId")


from __future__ import annotations

import base64

from ....infrastructure.api_client import ApiClient


class ApiArtifactStorage:
    def __init__(self, api: ApiClient) -> None:
        self._api = api

    def upload(
        self,
        experiment_id: str,
        name: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        res = self._api.post(
            "/api/sdk/artifacts",
            json={
                "experimentId": experiment_id,
                "name": name,
                "contentType": content_type,
                "dataBase64": base64.b64encode(data).decode("ascii"),
            },
        )
        return res.get("url") or res.get("path") or name


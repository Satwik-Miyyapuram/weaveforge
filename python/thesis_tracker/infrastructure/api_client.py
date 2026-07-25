from __future__ import annotations

import httpx


class ApiClient:
    def __init__(self, api_url: str, token: str) -> None:
        self._client = httpx.Client(
            base_url=api_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=60.0,
        )

    def get(self, path: str, params: dict | None = None) -> dict:
        r = self._client.get(path, params=params)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, json: dict) -> dict:
        r = self._client.post(path, json=json)
        r.raise_for_status()
        return r.json()

    def delete(self, path: str, params: dict | None = None) -> dict:
        r = self._client.delete(path, params=params)
        r.raise_for_status()
        return r.json() if r.content else {}

    def close(self) -> None:
        self._client.close()


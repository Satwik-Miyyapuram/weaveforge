from __future__ import annotations

import httpx


class ApiUrlRedirectError(RuntimeError):
    """The configured API URL redirects elsewhere.

    Following it is not safe: httpx drops the ``Authorization`` header on a
    cross-host redirect, so the retry would fail as unauthenticated and the
    real cause -- a misconfigured base URL -- would surface as a confusing
    401. Fail immediately and name the URL to use instead.
    """


def _check_redirect(response: httpx.Response) -> None:
    if not response.is_redirect:
        return
    target = response.headers.get("location", "")
    raise ApiUrlRedirectError(
        f"{response.request.url} redirected to {target!r}.\n"
        "Set WEAVEFORGE_API_URL (or api_url=) to the canonical origin so "
        "the Authorization header is not dropped by the redirect."
    )


class ApiClient:
    def __init__(self, api_url: str, token: str) -> None:
        self._client = httpx.Client(
            base_url=api_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=60.0,
        )

    def get(self, path: str, params: dict | None = None) -> dict:
        r = self._client.get(path, params=params)
        _check_redirect(r)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, json: dict) -> dict:
        r = self._client.post(path, json=json)
        _check_redirect(r)
        r.raise_for_status()
        return r.json()

    def delete(self, path: str, params: dict | None = None) -> dict:
        r = self._client.delete(path, params=params)
        _check_redirect(r)
        r.raise_for_status()
        return r.json() if r.content else {}

    def close(self) -> None:
        self._client.close()

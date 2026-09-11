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
            # Connection failures only -- a request that reached the server is
            # never replayed, so nothing is logged twice.
            transport=httpx.HTTPTransport(retries=3),
        )

    def __enter__(self) -> ApiClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        # Closes the connection pool on every path, including a raised one: an
        # exception inside the block is not a reason to leak sockets.
        self.close()

    def get(self, path: str, params: dict | None = None) -> dict:
        r = self._client.get(path, params=params)
        _check_redirect(r)
        r.raise_for_status()
        return r.json()

    def post(
        self, path: str, json: dict, timeout: float | None = None
    ) -> dict:
        """POST, optionally with a per-request ``timeout`` (seconds).

        ``timeout`` is passed only when given: httpx reads ``timeout=None`` as
        "wait forever", not "use the client default", so the two calls are kept
        separate rather than passing the argument through unconditionally. That
        is what keeps the 60s default for the sends a caller explicitly asked
        for, while the automatic metric flush supplies its own, much shorter one
        — see ``Run._auto_flush``.
        """
        if timeout is None:
            r = self._client.post(path, json=json)
        else:
            r = self._client.post(path, json=json, timeout=timeout)
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

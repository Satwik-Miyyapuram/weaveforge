from __future__ import annotations

import httpx
import pytest

from weaveforge.infrastructure.api_client import ApiClient, ApiUrlRedirectError


def _client(handler: httpx.MockTransport) -> ApiClient:
    client = ApiClient("https://example.test", "token-abc")
    client._client = httpx.Client(
        base_url="https://example.test",
        headers={"Authorization": "Bearer token-abc"},
        transport=handler,
    )
    return client


def test_get_returns_json_and_sends_the_bearer_token() -> None:
    seen: dict[str, str] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization", "")
        return httpx.Response(200, json={"ok": True})

    api = _client(httpx.MockTransport(handle))
    assert api.get("/api/sdk/whoami") == {"ok": True}
    assert seen["auth"] == "Bearer token-abc"


@pytest.mark.parametrize("status", [301, 302, 307, 308])
def test_a_redirecting_api_url_fails_with_an_actionable_message(status: int) -> None:
    # httpx drops Authorization across a host change, so silently following
    # this would surface as a confusing 401 instead of the real cause: a base
    # URL pointing at an alias rather than the canonical origin.
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, headers={"location": "https://canonical.test/api/sdk/whoami"})

    api = _client(httpx.MockTransport(handle))
    with pytest.raises(ApiUrlRedirectError) as excinfo:
        api.get("/api/sdk/whoami")
    message = str(excinfo.value)
    assert "canonical.test" in message
    assert "WEAVEFORGE_API_URL" in message


def test_redirects_are_caught_on_post_and_delete_too() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(307, headers={"location": "https://canonical.test/x"})

    api = _client(httpx.MockTransport(handle))
    with pytest.raises(ApiUrlRedirectError):
        api.post("/api/sdk/metrics", json={"a": 1})
    with pytest.raises(ApiUrlRedirectError):
        api.delete("/api/sdk/artifacts")


def test_a_real_error_status_still_raises_the_http_error() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "nope"})

    api = _client(httpx.MockTransport(handle))
    with pytest.raises(httpx.HTTPStatusError):
        api.get("/api/sdk/whoami")


def test_delete_tolerates_an_empty_body() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    api = _client(httpx.MockTransport(handle))
    assert api.delete("/api/sdk/artifacts") == {}

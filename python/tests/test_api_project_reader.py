"""ApiProjectReader against a mock transport: the 0.9.8 relay answers 410."""

from __future__ import annotations

import httpx
import pytest

from weaveforge.features.projects.infrastructure.api_project_reader import (
    ApiProjectReader,
    ProjectLookupMovedError,
)
from weaveforge.infrastructure.api_client import ApiClient


def _reader(status: int, body: dict) -> ApiProjectReader:
    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/sdk/projects"
        return httpx.Response(status, json=body)

    api = ApiClient("https://example.test", "token-abc")
    api._client = httpx.Client(
        base_url="https://example.test", transport=httpx.MockTransport(handle)
    )
    return ApiProjectReader(api)


def test_found_project_returns_its_id() -> None:
    assert _reader(200, {"projectId": "p-1"}).id_by_name("Thesis") == "p-1"


def test_gone_route_raises_a_clear_moved_error() -> None:
    reader = _reader(410, {"error": "This feature moved to your workspace files."})
    with pytest.raises(ProjectLookupMovedError) as caught:
        reader.id_by_name("Thesis")
    message = str(caught.value)
    assert "workspace files" in message
    assert "WEAVEFORGE_PROJECT_ID" in message
    assert isinstance(caught.value, RuntimeError)


def test_other_http_errors_are_not_reworded() -> None:
    with pytest.raises(httpx.HTTPStatusError):
        _reader(500, {"error": "boom"}).id_by_name("Thesis")

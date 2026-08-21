from __future__ import annotations

from typing import Any

from weaveforge.features.experiments.domain.metric_point import MetricPoint
from weaveforge.features.experiments.infrastructure.api_metric_repository import (
    MAX_POINTS_PER_REQUEST,
    ApiMetricRepository,
)


class RecordingApi:
    def __init__(self) -> None:
        self.posts: list[list[dict[str, Any]]] = []

    def post(self, path: str, json: dict[str, Any]) -> dict[str, Any]:
        assert path == "/api/sdk/metrics"
        self.posts.append(json["points"])
        return {"ok": True}


def _points(n: int) -> list[MetricPoint]:
    return [
        MetricPoint(experiment_id="exp", metric="loss", step=i, value=float(i))
        for i in range(n)
    ]


def test_an_empty_append_talks_to_nobody() -> None:
    api = RecordingApi()
    ApiMetricRepository(api).append([])  # type: ignore[arg-type]
    assert api.posts == []


def test_a_short_flush_is_still_one_request() -> None:
    api = RecordingApi()
    ApiMetricRepository(api).append(_points(3))  # type: ignore[arg-type]
    assert len(api.posts) == 1
    assert [p["step"] for p in api.posts[0]] == [0, 1, 2]


def test_a_flush_past_the_route_cap_is_split_rather_than_refused() -> None:
    # The route rejects a body over the cap, so a long log_history has to
    # arrive as several requests — every point, in order, none dropped.
    total = MAX_POINTS_PER_REQUEST * 2 + 7
    api = RecordingApi()
    ApiMetricRepository(api).append(_points(total))  # type: ignore[arg-type]

    assert len(api.posts) == 3
    assert [len(batch) for batch in api.posts] == [
        MAX_POINTS_PER_REQUEST,
        MAX_POINTS_PER_REQUEST,
        7,
    ]
    assert [p["step"] for batch in api.posts for p in batch] == list(range(total))

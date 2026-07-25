from __future__ import annotations

from collections.abc import Iterable

from ....infrastructure.api_client import ApiClient
from ..domain.metric_point import MetricPoint


class ApiMetricRepository:
    def __init__(self, api: ApiClient) -> None:
        self._api = api

    def append(self, points: Iterable[MetricPoint]) -> None:
        rows = [
            {
                "experiment_id": p.experiment_id,
                "metric": p.metric,
                "step": p.step,
                "value": p.value,
                "wall_time": p.wall_time,
            }
            for p in points
        ]
        if rows:
            self._api.post("/api/sdk/metrics", json={"points": rows})

    def history(self, experiment_id: str, metric: str | None = None) -> list[MetricPoint]:
        raise NotImplementedError("Metric history via API is not implemented yet.")


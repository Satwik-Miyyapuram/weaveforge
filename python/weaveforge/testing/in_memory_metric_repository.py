"""In-memory :class:`IMetricRepository`. History is returned step-ordered,
matching the ``experiment_metrics_series_idx`` ordering the Supabase adapter
relies on."""

from __future__ import annotations

from collections.abc import Iterable

from ..features.experiments.domain.metric_point import MetricPoint


class InMemoryMetricRepository:
    def __init__(self) -> None:
        self._points: list[MetricPoint] = []

    def append(self, points: Iterable[MetricPoint]) -> None:
        self._points.extend(points)

    def history(
        self, experiment_id: str, metric: str | None = None
    ) -> list[MetricPoint]:
        rows = [p for p in self._points if p.experiment_id == experiment_id]
        if metric is not None:
            rows = [p for p in rows if p.metric == metric]
        rows.sort(key=lambda p: (p.metric, p.step))
        return rows

"""Supabase adapter for :class:`IMetricRepository` (the ``experiment_metrics``
curve table, migration 0016). Appends are batched into a single insert;
``user_id`` is filled by the column default (``auth.uid()``)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ..domain.metric_point import MetricPoint

_TABLE = "experiment_metrics"


class SupabaseMetricRepository:
    def __init__(self, client: Any) -> None:
        self._db = client

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
            self._db.table(_TABLE).insert(rows).execute()

    def history(
        self, experiment_id: str, metric: str | None = None
    ) -> list[MetricPoint]:
        q = self._db.table(_TABLE).select("*").eq("experiment_id", experiment_id)
        if metric is not None:
            q = q.eq("metric", metric)
        res = q.order("metric").order("step").execute()
        return [
            MetricPoint(
                experiment_id=r["experiment_id"],
                metric=r["metric"],
                step=r["step"],
                value=r["value"],
                wall_time=r.get("wall_time"),
            )
            for r in (res.data or [])
        ]

from __future__ import annotations

from collections.abc import Iterable

from ....infrastructure.api_client import ApiClient
from ..domain.metric_point import MetricPoint

#: Points the ingest route accepts in one request (`metrics/limits.ts`).
#: A longer flush is sent as several requests rather than refused.
MAX_POINTS_PER_REQUEST = 5000


class ApiMetricRepository:
    """The write half of ``IMetricRepository``, over ``/api/sdk/metrics``.

    The SDK pushes curves; it does not draw them. The route is POST-only and the
    dashboard reads ``experiment_metrics`` through Supabase directly, so no
    endpoint could implement ``history`` — read
    ``apps/web/src/app/api/sdk/metrics/route.ts`` before adding one. Rather than
    invent a call, the read half refuses with a typed error (F4 of the pass-2
    review: a shipped adapter raised an unannounced ``NotImplementedError``).
    """

    def __init__(self, api: ApiClient) -> None:
        self._api = api

    def append(
        self, points: Iterable[MetricPoint], *, timeout: float | None = None
    ) -> None:
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
        for start in range(0, len(rows), MAX_POINTS_PER_REQUEST):
            chunk = rows[start : start + MAX_POINTS_PER_REQUEST]
            self._api.post("/api/sdk/metrics", json={"points": chunk}, timeout=timeout)

    def history(self, experiment_id: str, metric: str | None = None) -> list[MetricPoint]:
        raise MetricHistoryUnavailable(
            "Reading metric history over the SDK API is not implemented: "
            "apps/web/src/app/api/sdk/metrics/route.ts accepts POST only, and the "
            "dashboard reads experiment_metrics through Supabase directly. Use a "
            "SupabaseMetricRepository where a database connection is available."
        )

    def capabilities(self) -> frozenset[str]:
        """The port members this adapter actually implements.

        The proactive form of the same answer: a caller can ask before it calls,
        where ``history()`` only reports the gap by raising.
        """
        return frozenset({"append"})


class MetricHistoryUnavailable(NotImplementedError):
    """The adapter cannot read metric history.

    Subclasses ``NotImplementedError`` so existing ``except NotImplementedError``
    callers keep working, while naming the condition for callers that want to
    handle it specifically.
    """

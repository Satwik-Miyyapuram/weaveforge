"""Repository contract for step-indexed metric history (DIP).

Segregated from :class:`IExperimentRepository` (ISP): appending curve points is
a distinct capability from managing experiment rows, and a read-only chart view
needs only ``history``.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol, runtime_checkable

from .metric_point import MetricPoint


@runtime_checkable
class IMetricRepository(Protocol):
    def append(
        self, points: Iterable[MetricPoint], *, timeout: float | None = None
    ) -> None:
        """Persist a batch of samples. Implementations should insert in bulk.

        ``timeout`` is an optional per-request bound in seconds, for callers that
        must not block indefinitely (the SDK's automatic flush uses it so a
        training loop is not held hostage by an unreachable server). Adapters
        with no network of their own — in-memory, direct database — ignore it;
        ``None`` means the adapter's own default.
        """
        ...

    def history(
        self, experiment_id: str, metric: str | None = None
    ) -> list[MetricPoint]:
        """All samples for an experiment (optionally one metric), step-ordered."""
        ...

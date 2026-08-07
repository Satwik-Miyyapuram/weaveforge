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
    def append(self, points: Iterable[MetricPoint]) -> None:
        """Persist a batch of samples. Implementations should insert in bulk."""
        ...

    def history(
        self, experiment_id: str, metric: str | None = None
    ) -> list[MetricPoint]:
        """All samples for an experiment (optionally one metric), step-ordered."""
        ...

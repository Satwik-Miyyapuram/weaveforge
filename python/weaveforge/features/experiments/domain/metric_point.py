"""Step-indexed metric history — the domain value objects behind training
curves. One ``MetricPoint`` == one sample of one metric at one step, persisted
in the ``experiment_metrics`` table (migration 0016). This is what lets curves
synced from TensorBoard / wandb survive as full time-series rather than only
the flat summary on ``Experiment.metrics``.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def normalize_wall_time(value: Any) -> str | None:
    """Coerce a source's wall-clock value into an ISO-8601 string the
    ``timestamptz`` column accepts.

    Sources disagree on format: wandb's ``_timestamp`` is epoch **seconds**
    (float), some emit ``datetime``, the SDK emits ISO strings already. Without
    this, an epoch float reaches Postgres as ``"1699999999.0"`` and the insert
    fails. ``None`` stays ``None``; strings are assumed already parseable.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    return str(value)


@dataclass(frozen=True)
class MetricPoint:
    experiment_id: str
    metric: str
    step: int
    value: float
    #: ISO-8601 wall-clock time of the sample, if the source provides one.
    wall_time: str | None = None

    def __post_init__(self) -> None:
        # Normalize at the sink so every path (wandb, custom sources, Run) is safe.
        object.__setattr__(self, "wall_time", normalize_wall_time(self.wall_time))


@dataclass
class MetricSeries:
    """A named curve — all samples of one metric — as produced by a sync source
    before it is bound to an experiment id."""

    metric: str
    #: (step, value, wall_time) samples in step order.
    points: list[tuple[int, float, str | None]] = field(default_factory=list)

    def add(self, step: int, value: float, wall_time: str | None = None) -> None:
        self.points.append((step, float(value), wall_time))

    def to_points(self, experiment_id: str) -> Iterator[MetricPoint]:
        for step, value, wall_time in self.points:
            yield MetricPoint(experiment_id, self.metric, step, value, wall_time)

    @property
    def last_value(self) -> float | None:
        return self.points[-1][1] if self.points else None


def series_to_points(
    series: Iterable[MetricSeries], experiment_id: str
) -> Iterator[MetricPoint]:
    for s in series:
        yield from s.to_points(experiment_id)

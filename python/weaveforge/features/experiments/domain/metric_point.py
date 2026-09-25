"""Step-indexed metric history — the domain value objects behind training
curves. One ``MetricPoint`` == one sample of one metric at one step, read from
the ``experiment_metrics`` view: loose rows in ``experiment_metric_points`` plus
settled points packed into arrays in ``experiment_metric_chunks``
(``0114``/``0115``). This is what lets curves synced from TensorBoard / wandb
survive as full time-series rather than only the flat summary on
``Experiment.metrics``.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

#: What a source may hand us as a wall clock: epoch seconds (int/float), a
#: ``datetime``, or an already-formatted ISO string. Sources must pass the raw
#: value — stringifying an epoch float here is the bug this normalizer exists to
#: prevent (see :func:`normalize_wall_time`).
WallTimeInput = str | int | float | datetime | None

#: Epoch seconds written as a *string* — ``"1699999999.123456"``. Accepted
#: defensively (a source that stringifies is easy to write and hard to spot),
#: but only when the integer part has 9–10 digits: that range is 1973-03-03
#: through 2286-11-20, which covers every plausible epoch and deliberately
#: excludes ``YYYYMMDD`` (8 digits) and ``YYYYMMDDHHMMSS`` (14 digits), the two
#: numeric strings that are legitimately timestamps in another format.
_EPOCH_STRING = re.compile(r"^[+-]?\d{9,10}(?:\.\d+)?$")


def normalize_wall_time(value: Any) -> str | None:
    """Coerce a source's wall-clock value into an ISO-8601 string the
    ``timestamptz`` column accepts.

    Sources disagree on format: wandb's ``_timestamp`` is epoch **seconds**
    (float), some emit ``datetime``, the SDK emits ISO strings already. Without
    this, an epoch float reaches Postgres as ``"1699999999.0"`` and the insert
    fails. ``None`` stays ``None``; an unrecognised string is returned unchanged
    on the assumption it is already parseable.

    A numeric *string* in the epoch range is converted too (see
    :data:`_EPOCH_STRING`), because that is exactly the shape a caller gets from
    ``str(epoch_float)`` — the mistake that shipped in the wandb source. The
    conversion is deliberately narrow so a real ISO string (``2026-06-24T…``)
    or a basic-format date (``20260624``) is never reinterpreted as seconds
    since 1970.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    if isinstance(value, str) and _EPOCH_STRING.match(value.strip()):
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
    #: (step, value, wall_time) samples in step order. ``wall_time`` is whatever
    #: the source produced; it is normalized when the sample becomes a
    #: :class:`MetricPoint`.
    points: list[tuple[int, float, WallTimeInput]] = field(default_factory=list)

    def add(self, step: int, value: float, wall_time: WallTimeInput = None) -> None:
        self.points.append((step, float(value), wall_time))

    def to_points(self, experiment_id: str) -> Iterator[MetricPoint]:
        for step, value, wall_time in self.points:
            # Normalized here as well as in `MetricPoint.__post_init__` so the
            # tuple's wider `WallTimeInput` narrows to the entity's `str | None`
            # for the type checker (the normalization is idempotent).
            yield MetricPoint(
                experiment_id, self.metric, step, value, normalize_wall_time(wall_time)
            )

    @property
    def last_value(self) -> float | None:
        return self.points[-1][1] if self.points else None


def series_to_points(
    series: Iterable[MetricSeries], experiment_id: str
) -> Iterator[MetricPoint]:
    for s in series:
        yield from s.to_points(experiment_id)

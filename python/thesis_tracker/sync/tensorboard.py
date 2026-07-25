"""TensorBoard source — reads scalar curves from local event files.

Uses ``tbparse`` (installed by the ``[tensorboard]`` extra) to parse the
logdir; the row→series grouping is a pure function so it's testable without
event files.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ..features.experiments.domain.metric_point import MetricSeries
from .registry import default_registry
from .source import MissingDependencyError


def _scalars_to_series(
    rows: Iterable[tuple[str, int, float, str | None]]
) -> list[MetricSeries]:
    """Group ``(tag, step, value, wall_time)`` rows into one series per tag,
    each in step order."""
    by_tag: dict[str, MetricSeries] = {}
    for tag, step, value, wall_time in rows:
        series = by_tag.setdefault(tag, MetricSeries(tag))
        series.add(int(step), float(value), wall_time)
    for series in by_tag.values():
        series.points.sort(key=lambda p: p[0])
    return list(by_tag.values())


class TensorBoardSource:
    id = "tensorboard"

    def available(self) -> bool:
        try:
            import tbparse  # noqa: F401
        except ImportError:
            return False
        return True

    def read(self, logdir: Any) -> list[MetricSeries]:
        try:
            from tbparse import SummaryReader
        except ImportError as exc:
            raise MissingDependencyError("tensorboard", "tensorboard", "tbparse") from exc

        df = SummaryReader(str(logdir), pivot=False).scalars
        if df is None or len(df) == 0:
            return []
        has_wall = "wall_time" in df.columns
        rows = (
            (
                row.tag,
                row.step,
                row.value,
                str(row.wall_time) if has_wall else None,
            )
            for row in df.itertuples(index=False)
        )
        return _scalars_to_series(rows)


default_registry.register(TensorBoardSource(), replace=True)

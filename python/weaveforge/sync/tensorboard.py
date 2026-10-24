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
    rows: Iterable[tuple[str, int, float, Any, str]]
) -> list[MetricSeries]:
    """Group ``(tag, step, value, wall_time, dir_name)`` rows into one series
    per run and tag, each in step order.

    A logdir holding several runs (Keras writes ``train/`` and ``validation/``)
    has the same tags in each; the metric is then named ``<dir>/<tag>`` so the
    curves stay apart. A logdir with one run keeps bare tags, the names
    already stored for it. Event files at the root keep bare tags too.

    ``wall_time`` is passed through raw — tbparse hands back epoch seconds as a
    float and ``str()``-ing it here would bypass the epoch branch of
    :func:`~weaveforge.features.experiments.domain.metric_point.normalize_wall_time`
    and put a numeric string into a ``timestamptz`` column.
    """
    rows = list(rows)
    several_runs = len({row[4] for row in rows}) > 1
    by_tag: dict[str, MetricSeries] = {}
    for tag, step, value, wall_time, run_dir in rows:
        metric = f"{run_dir}/{tag}" if several_runs and run_dir else tag
        series = by_tag.setdefault(metric, MetricSeries(metric))
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

        df = SummaryReader(str(logdir), pivot=False, extra_columns={"dir_name"}).scalars
        if df is None or len(df) == 0:
            return []
        has_wall = "wall_time" in df.columns
        has_dir = "dir_name" in df.columns
        rows = (
            (
                row.tag,
                row.step,
                row.value,
                # Raw, not `str()`: see _scalars_to_series.
                row.wall_time if has_wall else None,
                (row.dir_name or "") if has_dir else "",
            )
            for row in df.itertuples(index=False)
        )
        return _scalars_to_series(rows)


default_registry.register(TensorBoardSource(), replace=True)

"""Weights & Biases source — imports a finished run's curves + summary, and
links the run's web page as an artifact. Needs the ``[wandb]`` extra and a
``run_path`` of the form ``entity/project/run_id``.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from typing import Any

from ..features.experiments.domain.metric_point import MetricSeries
from .registry import default_registry
from .source import Artifact, MissingDependencyError


def _history_to_series(rows: Iterable[dict[str, Any]]) -> list[MetricSeries]:
    """Pure: wandb history rows (dicts keyed by metric, with ``_step``) →
    one series per numeric metric. Internal ``_``-prefixed keys are skipped."""
    by_metric: dict[str, MetricSeries] = {}
    for i, row in enumerate(rows):
        step = row.get("_step", i)
        wall = row.get("_timestamp")
        for key, value in row.items():
            if key.startswith("_"):
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            series = by_metric.setdefault(key, MetricSeries(key))
            series.add(int(step), float(value), str(wall) if wall is not None else None)
    return list(by_metric.values())


class WandbSource:
    id = "wandb"

    def available(self) -> bool:
        try:
            import wandb  # noqa: F401
        except ImportError:
            return False
        return True

    def _run(self, run_path: str) -> Any:
        try:
            import wandb
        except ImportError as exc:
            raise MissingDependencyError("wandb", "wandb", "wandb") from exc
        return wandb.Api().run(str(run_path))

    def read(self, run_path: str) -> list[MetricSeries]:
        run = self._run(run_path)
        return _history_to_series(run.scan_history())

    def collect(self, run_path: str) -> Iterator[Artifact]:
        run = self._run(run_path)
        url = getattr(run, "url", None)
        if url:
            yield Artifact(name="wandb-run", url=url)


default_registry.register(WandbSource(), replace=True)

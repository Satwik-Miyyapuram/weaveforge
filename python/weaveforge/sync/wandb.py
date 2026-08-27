"""Weights & Biases, in both directions.

Reading imports a finished run's curves and summary and links its web page as
an artifact; ``run_path`` is ``entity/project/run_id``. Mirroring is the live
half: a run tracked here is carried into W&B as it happens, so a lab that
already watches W&B dashboards keeps watching them. Both need the ``[wandb]``
extra.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterable, Iterator, Mapping
from typing import Any

from ..features.experiments.domain.metric_point import MetricSeries
from .registry import default_registry
from .source import Artifact, MissingDependencyError

_log = logging.getLogger(__name__)


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

    def open(self, *, name: str, config: Mapping[str, Any]) -> _WandbMirror:
        try:
            import wandb
        except ImportError as exc:
            raise MissingDependencyError("wandb", "wandb", "wandb") from exc
        # An API key or an already-logged-in machine means online; nothing means
        # a local directory, because a training script must not stop to ask.
        signed_in = bool(os.environ.get("WANDB_API_KEY"))
        mode = os.environ.get("WANDB_MODE") or ("online" if signed_in else "offline")
        run = wandb.init(
            project=os.environ.get("WANDB_PROJECT"),
            name=name,
            config=dict(config),
            mode=mode,
            reinit=True,
        )
        return _WandbMirror(run)

    def read(self, run_path: str) -> list[MetricSeries]:
        run = self._run(run_path)
        return _history_to_series(run.scan_history())

    def collect(self, run_path: str) -> Iterator[Artifact]:
        run = self._run(run_path)
        url = getattr(run, "url", None)
        if url:
            yield Artifact(name="wandb-run", url=url)



class _WandbMirror:
    """One live W&B run, and a promise never to interrupt training.

    W&B is a network service in the middle of a loop that may be hours from its
    last checkpoint, so every call is wrapped: the first failure is logged, the
    mirror switches itself off, and the run carries on writing where it always
    was. Without credentials it starts in ``offline`` mode rather than blocking
    on a login prompt — the run lands in a local W&B directory to sync later,
    which is the same bargain the desktop app makes.
    """

    def __init__(self, run: Any) -> None:
        self._run: Any | None = run

    @property
    def url(self) -> str | None:
        return getattr(self._run, "url", None) if self._run else None

    def _stop(self, doing: str, error: Exception) -> None:
        _log.warning("W&B mirroring stopped after failing to %s: %s", doing, error)
        self._run = None

    def log(self, metrics: Mapping[str, float], step: int | None) -> None:
        if self._run is None:
            return
        try:
            self._run.log(dict(metrics), step=step)
        except Exception as error:  # noqa: BLE001 - never break the training loop
            self._stop("log", error)

    def finish(self, status: str) -> None:
        run, self._run = self._run, None
        if run is None:
            return
        try:
            # W&B's own vocabulary: 0 finished, 1 crashed. Anything that is not
            # a clean finish here is a run that stopped early.
            run.finish(exit_code=0 if status == "done" else 1)
        except Exception as error:  # noqa: BLE001
            _log.warning("W&B mirroring could not close its run: %s", error)

default_registry.register(WandbSource(), replace=True)

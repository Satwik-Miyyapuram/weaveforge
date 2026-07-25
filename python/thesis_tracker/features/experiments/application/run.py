"""The ``Run`` — the one handle every capability hangs off.

A run wraps a single experiment row and buffers step-indexed metric history so
training loops can log cheaply. It's created and finalized by :func:`track` /
:func:`track_experiment`, which stamp status and flush on exit. New capabilities
(more loggers, more artifact kinds) become new ``Run`` methods or new registered
sync sources — never new call sites in user code. That's the design intent
behind "the decorator does everything down the line."
"""

from __future__ import annotations

import io
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from typing import Any

from ....sync.registry import SyncRegistry, default_registry
from ....sync.source import ArtifactSource, MetricSource
from ...experiments.domain.experiment import Experiment, ExperimentStatus
from ...experiments.domain.metric_point import MetricPoint
from .manage_experiment import ManageExperimentUseCase

#: Uploader signature: (experiment_id, name, data, content_type) -> link URL.
Uploader = Callable[[str, str, bytes, str], str]

_FLUSH_EVERY = 1000
_CONTENT_TYPES = {
    "png": "image/png",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
}


class Run:
    def __init__(
        self,
        manage: ManageExperimentUseCase,
        experiment: Experiment,
        *,
        uploader: Uploader | None = None,
        registry: SyncRegistry = default_registry,
    ) -> None:
        self._manage = manage
        self.experiment = experiment
        self._uploader = uploader
        self._registry = registry
        self._buffer: list[MetricPoint] = []
        self._last: dict[str, float] = {}
        self._fig_seq = 0

    @property
    def id(self) -> str:
        return self.experiment.id

    # --- metrics ---------------------------------------------------------
    def log_metric(self, name: str, value: float, step: int | None = None) -> None:
        """One metric sample. With ``step`` it joins the curve (history); without
        a step it's a summary value written to ``experiments.metrics``."""
        if step is None:
            self.log_summary({name: value})
            return
        wall = datetime.now(timezone.utc).isoformat()
        self._buffer.append(MetricPoint(self.id, name, int(step), float(value), wall))
        self._last[name] = float(value)
        if len(self._buffer) >= _FLUSH_EVERY:
            self.flush()

    def log_metrics(self, metrics: dict[str, float], step: int | None = None) -> None:
        if step is None:
            self.log_summary(metrics)
            return
        for name, value in metrics.items():
            self.log_metric(name, value, step)

    def log_summary(self, metrics: dict[str, Any]) -> None:
        """Merge flat summary values into ``experiments.metrics`` (the chips the
        dashboard shows)."""
        self.experiment = self._manage.record_metrics(
            self.id, dict(metrics), existing=self.experiment
        )

    # --- artifacts -------------------------------------------------------
    def log_figure(self, figure: Any, name: str | None = None, fmt: str = "png") -> str:
        """Save a matplotlib (or any ``savefig``-capable) figure and attach it.

        Duck-typed on ``savefig`` so this needs no matplotlib import; the
        ``[figures]`` extra only adds WebP compression on top (see sync.matplotlib).
        """
        buf = io.BytesIO()
        figure.savefig(buf, format=fmt, bbox_inches="tight")
        self._fig_seq += 1
        fname = name or f"figure-{self._fig_seq}"
        if "." not in fname:
            fname = f"{fname}.{fmt}"
        ctype = _CONTENT_TYPES.get(fmt, "application/octet-stream")
        return self.log_bytes(fname, buf.getvalue(), ctype)

    def log_bytes(
        self, name: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str:
        if self._uploader is None:
            raise RuntimeError(
                "This run has no artifact storage wired — cannot upload bytes. "
                "Use a run created via track()/track_experiment(), or pass log_artifact(url)."
            )
        url = self._uploader(self.id, name, data, content_type)
        self.experiment = self._manage.add_artifacts(self.id, [url], existing=self.experiment)
        return url

    def log_artifact(self, url: str) -> None:
        """Attach an already-hosted link (a wandb run, an S3 object, …)."""
        self.experiment = self._manage.add_artifacts(self.id, [url], existing=self.experiment)

    # --- status ----------------------------------------------------------
    def set_status(self, status: ExperimentStatus) -> None:
        self.experiment = self._manage.set_status(self.id, status, existing=self.experiment)

    # --- sync sources ----------------------------------------------------
    def sync(self, source_id: str, ref: Any) -> None:
        """Pull curves and/or artifacts from a registered source.

        Works with any source in the registry, so a user's own ``MetricSource``
        is driven by the exact same call as the built-in ones (Open/Closed)."""
        source = self._registry.get(source_id)
        # A source may be a MetricSource, an ArtifactSource, or both; the
        # runtime-checkable protocols let us dispatch on the roles it fills.
        if isinstance(source, MetricSource):
            self._ingest_series(source.read(ref))
        if isinstance(source, ArtifactSource):
            self._ingest_artifacts(source.collect(ref))

    def sync_tensorboard(self, logdir: str) -> None:
        self.sync("tensorboard", logdir)

    def sync_wandb(self, run_path: str) -> None:
        self.sync("wandb", run_path)

    def _ingest_series(self, series: Iterable[Any]) -> None:
        for s in series:
            self._buffer.extend(s.to_points(self.id))
            if s.last_value is not None:
                self._last[s.metric] = s.last_value
            if len(self._buffer) >= _FLUSH_EVERY:
                self.flush()

    def _ingest_artifacts(self, artifacts: Iterable[Any]) -> None:
        for art in artifacts:
            if art.url:
                self.log_artifact(art.url)
            elif art.data is not None:
                self.log_bytes(art.name, art.data, art.content_type)

    # --- lifecycle -------------------------------------------------------
    def flush(self) -> None:
        """Persist buffered history and fold the latest per-metric value into the
        summary so the dashboard shows final numbers even without the chart."""
        if self._buffer:
            self._manage.record_history(self._buffer)
            self._buffer.clear()
        if self._last:
            self.log_summary(dict(self._last))
            self._last.clear()

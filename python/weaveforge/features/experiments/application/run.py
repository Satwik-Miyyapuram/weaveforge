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
import threading
import warnings
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from typing import Any

from ....sync.registry import SyncRegistry, default_registry
from ....sync.source import ArtifactSource, MetricSource, Mirror
from ...experiments.domain.experiment import Experiment, ExperimentStatus
from ...experiments.domain.metric_point import MetricPoint
from .manage_experiment import ManageExperimentUseCase

#: Uploader signature: (experiment_id, name, data, content_type) -> link URL.
Uploader = Callable[[str, str, bytes, str], str]

_FLUSH_EVERY = 1000
#: Points kept while the server is unreachable before the oldest are dropped.
_MAX_BUFFERED = 20 * _FLUSH_EVERY
#: Seconds an *automatic* flush may spend on one request before giving up. The
#: training loop is blocked by it, so it is deliberately far below the client's
#: 60s: a run whose server vanished must keep training. An explicit ``flush()``
#: passes no timeout and keeps the client's own, because there the caller asked
#: for the send and wants it to succeed. Note that httpx' transport still
#: retries failed *connections* up to three times, so the worst case is a small
#: multiple of this, not this exactly.
_AUTO_FLUSH_TIMEOUT = 10.0
_CONTENT_TYPES = {
    "png": "image/png",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
}


class Run:
    """One tracked run.

    Threading contract
    ------------------
    ``log_metric`` / ``log_metrics`` / ``sync`` may be called from several
    threads (a data loader logging from a worker is the usual reason), and
    ``flush`` may run concurrently with them. The buffer and the pending-summary
    map are therefore only ever touched under ``_lock``, and a flush *swaps*
    both out rather than draining them in place:

    - two threads crossing the flush threshold together cannot send the same
      point twice — only the thread that took the batch sends it (a double send
      is a unique-violation on ``(experiment_id, metric, step)``, i.e. a 500);
    - a point logged while a send is in flight lands in the fresh buffer and is
      sent by the next flush instead of being dropped by a ``clear()`` that ran
      after it was appended;
    - a failed send puts its batch back at the front of the buffer, so the
      automatic retry re-sends exactly what failed.

    The lock is never held across I/O (the mirror call, ``record_history``, the
    summary write), so a slow server cannot block the logging thread on the lock
    itself. Point *ordinality* across threads follows append order, which is the
    most a multi-writer buffer can promise.
    """

    def __init__(
        self,
        manage: ManageExperimentUseCase,
        experiment: Experiment,
        *,
        uploader: Uploader | None = None,
        registry: SyncRegistry = default_registry,
        mirror: Mirror | None = None,
    ) -> None:
        self._manage = manage
        self.experiment = experiment
        self._uploader = uploader
        self._registry = registry
        self._mirror = mirror
        self._lock = threading.Lock()
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
        point = MetricPoint(self.id, name, int(step), float(value), wall)
        with self._lock:
            self._buffer.append(point)
            self._last[name] = float(value)
        # Outside the lock: the mirror is network I/O and must not serialise the
        # buffer, and it never holds anything this object owns.
        if self._mirror is not None:
            self._mirror.log({name: float(value)}, int(step))
        self._flush_when_full()

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
        # A run has one ending, and this is where every path reaches it: the
        # mirror is told once and then forgotten, so a later status change
        # cannot reopen a run somebody else has already closed.
        if self._mirror is not None:
            self._mirror.finish(status)
            self._mirror = None

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
            with self._lock:
                self._buffer.extend(s.to_points(self.id))
                if s.last_value is not None:
                    self._last[s.metric] = s.last_value
            self._flush_when_full()

    def _ingest_artifacts(self, artifacts: Iterable[Any]) -> None:
        for art in artifacts:
            if art.url:
                self.log_artifact(art.url)
            elif art.data is not None:
                self.log_bytes(art.name, art.data, art.content_type)

    def _flush_when_full(self) -> None:
        """Flush once the buffer has reached the threshold.

        The length is read under the lock, but the decision is re-made inside
        :meth:`flush`: two threads can both see a full buffer, and the swap
        there is what guarantees only one of them sends it.
        """
        with self._lock:
            full = len(self._buffer) >= _FLUSH_EVERY
        if full:
            self._auto_flush()

    def _auto_flush(self) -> None:
        """A flush the training loop did not ask for. A server that is down for
        a minute must not end the run: keep the points, warn once, and try again
        at the next threshold. An explicit ``flush()`` still raises.

        The send is bounded by ``_AUTO_FLUSH_TIMEOUT`` so a server that has gone
        away cannot hold the training loop for the client's full 60s (times the
        transport's connect retries) on every threshold. It remains a
        *synchronous* send: a bounded background sender would let this return
        immediately, but it would also have to take over the retry and
        back-pressure semantics ``flush()`` promises, and that is a larger change
        than this review should land. What remains, honestly: the calling thread
        waits up to ``_AUTO_FLUSH_TIMEOUT`` per automatic flush attempt.
        """
        try:
            self.flush(timeout=_AUTO_FLUSH_TIMEOUT)
        except Exception as exc:  # noqa: BLE001 - network errors of any shape
            warnings.warn(f"weaveforge: could not send metrics, will retry ({exc})", stacklevel=3)
            with self._lock:
                if len(self._buffer) > _MAX_BUFFERED:
                    del self._buffer[: len(self._buffer) - _MAX_BUFFERED]

    # --- lifecycle -------------------------------------------------------
    def flush(self, *, timeout: float | None = None) -> None:
        """Persist buffered history and fold the latest per-metric value into the
        summary so the dashboard shows final numbers even without the chart.

        The threading contract lives on the class docstring; the mechanics are
        here. The batch and the pending summary are swapped out under the lock
        and sent outside it, so a concurrent ``log_metric`` never blocks on a
        slow server and never loses a point to a ``clear()``. A batch that fails
        to send is put back, so the retry re-sends exactly what failed.
        ``timeout`` bounds the send in seconds; ``None`` keeps the adapter's own
        default.
        """
        with self._lock:
            pending = self._buffer
            self._buffer = []
            summary = self._last
            self._last = {}
        if pending:
            try:
                self._manage.record_history(pending, timeout=timeout)
            except BaseException:
                # Put the points back at the front, in order: they were never
                # stored, and the caller that keeps the run alive
                # (``_auto_flush``) intends to try again.
                with self._lock:
                    self._buffer[:0] = pending
                raise
        if summary:
            try:
                self.log_summary(dict(summary))
            except BaseException:
                # Same reasoning for the folded summary values. A value logged
                # while that write was in flight is newer and wins.
                with self._lock:
                    for name, value in summary.items():
                        self._last.setdefault(name, value)
                raise

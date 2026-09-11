"""A run keeps training when the server is briefly unreachable — and keeps its
points when two threads flush at once."""

import threading
import time
import warnings

import pytest

from weaveforge import NewExperimentInput, track
from weaveforge.features.experiments.application import ManageExperimentUseCase
from weaveforge.features.experiments.application import run as run_module
from weaveforge.features.experiments.application.run import Run
from weaveforge.testing import (
    FixedClock,
    InMemoryExperimentRepository,
    InMemoryMetricRepository,
    MemoryContainer,
    SeqIdGenerator,
)


class _FlakyMetrics(InMemoryMetricRepository):
    def __init__(self) -> None:
        super().__init__()
        self.fail = True

    def append(self, points, *, timeout=None):  # type: ignore[override]
        if self.fail:
            raise ConnectionError("boom")
        return super().append(points, timeout=timeout)


def _run(monkeypatch):
    monkeypatch.setattr(run_module, "_FLUSH_EVERY", 2)
    metrics = _FlakyMetrics()
    clock = FixedClock("2026-06-24T12:00:00.000Z")
    uc = ManageExperimentUseCase(InMemoryExperimentRepository(), clock, SeqIdGenerator(), metrics)
    return metrics, Run(uc, uc.add(NewExperimentInput(name="x")))


def test_auto_flush_failure_warns_and_keeps_points(monkeypatch):
    metrics, run = _run(monkeypatch)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        run.log_metric("loss", 1.0, step=0)
        run.log_metric("loss", 0.5, step=1)  # threshold: flush fails, run survives
    assert any("could not send metrics" in str(w.message) for w in caught)
    metrics.fail = False
    run.log_metric("loss", 0.25, step=2)
    run.flush()
    assert [p.value for p in metrics.history(run.id, "loss")] == [1.0, 0.5, 0.25]


def test_explicit_flush_still_raises(monkeypatch):
    _, run = _run(monkeypatch)
    run.log_metric("loss", 1.0, step=0)
    with pytest.raises(ConnectionError):
        run.flush()


def test_the_automatic_flush_bounds_its_own_timeout(monkeypatch):
    """A server that has gone away must not hold the training loop for the
    client's full timeout; the explicit flush is the only one that waits."""
    seen = []

    class _Spy(Run):
        def flush(self, *, timeout=None):
            seen.append(timeout)
            return super().flush(timeout=timeout)

    metrics = _FlakyMetrics()
    clock = FixedClock("2026-06-24T12:00:00.000Z")
    uc = ManageExperimentUseCase(InMemoryExperimentRepository(), clock, SeqIdGenerator(), metrics)
    run = _Spy(uc, uc.add(NewExperimentInput(name="x")))
    monkeypatch.setattr(run_module, "_FLUSH_EVERY", 2)
    with warnings.catch_warnings(record=True):
        warnings.simplefilter("always")
        run.log_metric("loss", 1.0, step=0)
        run.log_metric("loss", 0.5, step=1)
    assert seen == [run_module._AUTO_FLUSH_TIMEOUT]
    assert run_module._AUTO_FLUSH_TIMEOUT < 60.0
    metrics.fail = False
    run.flush()  # explicit: no bound of its own
    assert seen[-1] is None


class _TrainingFailed(RuntimeError):
    """Distinct from the ConnectionError the metrics server raises, so the test
    can tell which one surfaced."""


def test_a_crash_whose_flush_also_fails_keeps_the_training_error(monkeypatch):
    """The regression this guards: the flush ran first, so a dead network
    replaced the user's exception with a connection error *and* left the run
    marked ``running``."""
    monkeypatch.setattr("weaveforge.tracking.capture_git_state", lambda cwd=None: {})
    metrics = _FlakyMetrics()
    container = MemoryContainer(metrics=metrics)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        with pytest.raises(_TrainingFailed, match="kaboom"):
            with track("crashy", container=container) as run:
                run.log_metric("loss", 1.0, step=0)
                raise _TrainingFailed("kaboom")

    assert any("could not send metrics" in str(w.message) for w in caught)
    experiment = container.experiments.list()[0]
    assert experiment.status == "failed"
    assert experiment.finished_at is not None

    # The batch was not lost with the failed send: a later flush still stores it.
    metrics.fail = False
    run.flush()
    assert [p.value for p in metrics.history(run.id, "loss")] == [1.0]


class _GatedMetrics(InMemoryMetricRepository):
    """Freezes each batch at call time — as a real adapter does when it
    serialises the points into a request body — and holds the first call open
    until the test releases it, so the send window is deterministic."""

    def __init__(self) -> None:
        super().__init__()
        self.entered = threading.Event()
        self.release = threading.Event()
        self.calls = 0

    def append(self, points, *, timeout=None):  # type: ignore[override]
        batch = list(points)
        self.calls += 1
        if self.calls == 1:
            self.entered.set()
            if not self.release.wait(5):
                raise TimeoutError("the test never released the gated append")
        return super().append(batch, timeout=timeout)


def test_a_point_logged_while_a_flush_is_in_flight_is_not_dropped():
    metrics = _GatedMetrics()
    clock = FixedClock("2026-06-24T12:00:00.000Z")
    uc = ManageExperimentUseCase(InMemoryExperimentRepository(), clock, SeqIdGenerator(), metrics)
    run = Run(uc, uc.add(NewExperimentInput(name="x")))

    run.log_metric("loss", 1.0, step=0)
    run.log_metric("loss", 0.5, step=1)

    flusher = threading.Thread(target=run.flush, name="flusher")
    flusher.start()
    assert metrics.entered.wait(5), "the flush never reached the repository"
    # The first two points are mid-send. This one must land in the next batch,
    # not in the batch being sent and not in a `clear()` that follows it.
    run.log_metric("loss", 0.25, step=2)
    metrics.release.set()
    flusher.join(5)
    assert not flusher.is_alive()

    run.flush()
    assert [p.value for p in metrics.history(run.id, "loss")] == [1.0, 0.5, 0.25]


class _RecordingMetrics(InMemoryMetricRepository):
    """Records every point it is asked to store, so a double send — which a real
    database answers with a unique violation, i.e. a 500 — shows up as a
    duplicate."""

    def __init__(self) -> None:
        super().__init__()
        self.seen: list[tuple[str, int]] = []
        self._guard = threading.Lock()

    def append(self, points, *, timeout=None):  # type: ignore[override]
        batch = list(points)
        # Widen the window between "this batch was taken" and "this batch was
        # written". With the old drain-then-clear flush, two threads crossing the
        # threshold together both handed the same points to the repository.
        time.sleep(0.001)
        with self._guard:
            self.seen.extend((p.metric, p.step) for p in batch)
        return super().append(batch, timeout=timeout)


def test_concurrent_logging_sends_every_point_exactly_once(monkeypatch):
    monkeypatch.setattr(run_module, "_FLUSH_EVERY", 8)
    metrics = _RecordingMetrics()
    clock = FixedClock("2026-06-24T12:00:00.000Z")
    uc = ManageExperimentUseCase(InMemoryExperimentRepository(), clock, SeqIdGenerator(), metrics)
    run = Run(uc, uc.add(NewExperimentInput(name="x")))

    per_thread = 200
    start = threading.Barrier(2)

    def worker(metric: str) -> None:
        start.wait(5)
        for step in range(per_thread):
            run.log_metric(metric, float(step), step=step)

    threads = [threading.Thread(target=worker, args=(name,)) for name in ("a", "b")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
        assert not thread.is_alive()
    run.flush()

    expected = sorted(
        (metric, step) for metric in ("a", "b") for step in range(per_thread)
    )
    assert sorted(metrics.seen) == expected

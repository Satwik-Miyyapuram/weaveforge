"""A run keeps training when the server is briefly unreachable."""

import warnings

import pytest

from weaveforge import NewExperimentInput
from weaveforge.features.experiments.application import ManageExperimentUseCase
from weaveforge.features.experiments.application import run as run_module
from weaveforge.features.experiments.application.run import Run
from weaveforge.testing import (
    FixedClock,
    InMemoryExperimentRepository,
    InMemoryMetricRepository,
    SeqIdGenerator,
)


class _FlakyMetrics(InMemoryMetricRepository):
    def __init__(self) -> None:
        super().__init__()
        self.fail = True

    def append(self, points):  # type: ignore[override]
        if self.fail:
            raise ConnectionError("boom")
        return super().append(points)


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

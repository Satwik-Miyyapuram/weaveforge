"""B60: the SDK's exit path, retry pacing and row mapping.

- 43-01: a ``sync`` that is not a mapping cannot skip the status write.
- 43-02: the documented ``sync`` example is the shape ``track`` accepts.
- 43-05: a failed history send keeps the pending summary values.
- 43-06: a server that stays down is retried less and less often.
- 43-12: the API and PostgREST adapters share one row mapping.
"""

import warnings

import pytest

import weaveforge
from weaveforge import NewExperimentInput, track
from weaveforge.features.experiments.application import ManageExperimentUseCase
from weaveforge.features.experiments.application import run as run_module
from weaveforge.features.experiments.application.run import Run
from weaveforge.features.experiments.infrastructure import (
    api_experiment_repository,
    postgrest_experiment_repository,
)
from weaveforge.sync import registry
from weaveforge.testing import (
    FixedClock,
    InMemoryExperimentRepository,
    InMemoryMetricRepository,
    MemoryContainer,
    SeqIdGenerator,
)


class _DownMetrics(InMemoryMetricRepository):
    """A metrics store whose server is down until ``fail`` is cleared."""

    def __init__(self) -> None:
        super().__init__()
        self.fail = True
        self.calls = 0

    def append(self, points, *, timeout=None):  # type: ignore[override]
        self.calls += 1
        if self.fail:
            raise ConnectionError("down")
        return super().append(points, timeout=timeout)


def _run(monkeypatch, every=2):
    monkeypatch.setattr(run_module, "_FLUSH_EVERY", every)
    metrics = _DownMetrics()
    uc = ManageExperimentUseCase(
        InMemoryExperimentRepository(),
        FixedClock("2026-06-24T12:00:00.000Z"),
        SeqIdGenerator(),
        metrics,
    )
    return metrics, Run(uc, uc.add(NewExperimentInput(name="x")))


@pytest.fixture(autouse=True)
def _no_git(monkeypatch):
    monkeypatch.setattr("weaveforge.tracking.capture_git_state", lambda cwd=None: {})


# --- 43-01 ---------------------------------------------------------------
@pytest.mark.parametrize("bad", [["tensorboard"], "tensorboard", 3])
def test_a_sync_that_is_not_a_mapping_still_marks_the_run_done(bad):
    container = MemoryContainer()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with pytest.raises(TypeError, match="mapping"):
            with track("x", container=container, sync=bad):
                pass
    assert container.experiments.list()[0].status == "done"


def test_a_bad_sync_on_the_failure_path_keeps_the_training_error():
    container = MemoryContainer()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        with pytest.raises(RuntimeError, match="train"):
            with track("x", container=container, sync=["tensorboard"]):
                raise RuntimeError("train")
    assert container.experiments.list()[0].status == "failed"
    assert not any("mapping" in str(w.message) for w in caught)


def test_an_empty_sync_mapping_is_fine():
    container = MemoryContainer()
    with track("x", container=container, sync={}):
        pass
    assert container.experiments.list()[0].status == "done"


# --- 43-02 ---------------------------------------------------------------
@pytest.mark.parametrize("doc", [weaveforge.__doc__, registry.__doc__], ids=["package", "registry"])
def test_the_docs_show_sync_as_a_mapping(doc):
    assert 'sync=["' not in doc
    assert "sync={" in doc


# --- 43-05 ---------------------------------------------------------------
def test_a_failed_history_send_keeps_the_summary(monkeypatch):
    metrics, run = _run(monkeypatch, every=1000)
    run.log_metric("loss", 0.5, step=0)
    with pytest.raises(ConnectionError):
        run.flush()
    assert "loss" not in run.experiment.metrics
    metrics.fail = False
    run.flush()
    assert run.experiment.metrics["loss"] == 0.5
    assert [p.value for p in metrics.history(run.id, "loss")] == [0.5]


def test_a_newer_value_logged_after_the_failure_wins(monkeypatch):
    metrics, run = _run(monkeypatch, every=1000)
    run.log_metric("loss", 0.5, step=0)
    with pytest.raises(ConnectionError):
        run.flush()
    run.log_metric("loss", 0.25, step=1)
    metrics.fail = False
    run.flush()
    assert run.experiment.metrics["loss"] == 0.25


# --- 43-06 ---------------------------------------------------------------
def test_a_server_that_stays_down_is_retried_with_backoff(monkeypatch):
    metrics, run = _run(monkeypatch, every=2)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for step in range(400):
            run.log_metric("loss", float(step), step=step)
    # Without backoff every point past the threshold re-sends (~399 calls).
    assert metrics.calls <= 12


def test_backoff_resets_after_a_successful_send(monkeypatch):
    metrics, run = _run(monkeypatch, every=2)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for step in range(40):
            run.log_metric("loss", float(step), step=step)
    metrics.fail = False
    run.flush()
    sent = metrics.calls
    for step in range(40, 46):
        run.log_metric("loss", float(step), step=step)
    # Healthy again: back to one send per threshold.
    assert metrics.calls - sent == 3
    assert len(metrics.history(run.id, "loss")) == 46


def test_a_run_whose_server_stays_down_still_finishes(monkeypatch):
    monkeypatch.setattr(run_module, "_FLUSH_EVERY", 2)
    metrics = _DownMetrics()
    container = MemoryContainer(metrics=metrics)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with pytest.raises(ConnectionError):
            with track("x", container=container) as run:
                for step in range(200):
                    run.log_metric("loss", float(step), step=step)
    assert container.experiments.list()[0].status == "done"
    assert metrics.calls <= 12


# --- 43-12 ---------------------------------------------------------------
def test_one_row_mapping_for_both_adapters():
    assert api_experiment_repository.to_row is postgrest_experiment_repository.to_row
    assert api_experiment_repository.to_domain is postgrest_experiment_repository.to_domain

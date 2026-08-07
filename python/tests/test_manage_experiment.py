"""Use-case unit tests — port of ``manage-experiment.usecase.test.ts``."""

import pytest

from weaveforge import NewExperimentInput, short_sha
from weaveforge.features.experiments.application import ManageExperimentUseCase
from weaveforge.features.experiments.domain.experiment import ExperimentValidationError
from weaveforge.features.experiments.domain.metric_point import MetricPoint
from weaveforge.testing import (
    FixedClock,
    InMemoryExperimentRepository,
    InMemoryMetricRepository,
    SeqIdGenerator,
)

ISO = "2026-06-24T12:00:00.000Z"


def make_uc(with_metrics: bool = False):
    repo = InMemoryExperimentRepository()
    metrics = InMemoryMetricRepository() if with_metrics else None
    uc = ManageExperimentUseCase(repo, FixedClock(ISO), SeqIdGenerator(), metrics)
    return repo, metrics, uc


def test_add_applies_defaults():
    _, _, uc = make_uc()
    e = uc.add(NewExperimentInput(name="beta-vae sweep"))
    assert e.status == "planned"
    assert e.config == {}
    assert e.artifacts == []


def test_add_rejects_empty_name():
    _, _, uc = make_uc()
    with pytest.raises(ExperimentValidationError):
        uc.add(NewExperimentInput(name="  "))


def test_set_status_stamps_timestamps():
    _, _, uc = make_uc()
    e = uc.add(NewExperimentInput(name="x"))
    r = uc.set_status(e.id, "running")
    assert r.started_at == ISO
    d = uc.set_status(e.id, "done")
    assert d.finished_at == ISO


def test_add_running_stamps_started():
    _, _, uc = make_uc()
    e = uc.add(NewExperimentInput(name="x", status="running"))
    assert e.started_at == ISO


def test_record_metrics_merges():
    _, _, uc = make_uc()
    e = uc.add(NewExperimentInput(name="x", metrics={"val_loss": 0.2}))
    r = uc.record_metrics(e.id, {"mig": 0.41})
    assert r.metrics == {"val_loss": 0.2, "mig": 0.41}


def test_record_metrics_uses_existing_without_refetch():
    repo, _, uc = make_uc()
    e = uc.add(NewExperimentInput(name="x", metrics={"val_loss": 0.2}))
    repo.get_by_id = lambda _id: (_ for _ in ()).throw(AssertionError("should not refetch"))  # type: ignore[method-assign]
    r = uc.record_metrics(e.id, {"mig": 0.41}, existing=e)
    assert r.metrics == {"val_loss": 0.2, "mig": 0.41}


def test_add_artifacts_dedupes():
    _, _, uc = make_uc()
    e = uc.add(NewExperimentInput(name="x"))
    uc.add_artifacts(e.id, ["a", "b"])
    r = uc.add_artifacts(e.id, ["b", "c"])
    assert r.artifacts == ["a", "b", "c"]


def test_record_history_persists_points():
    _, metrics, uc = make_uc(with_metrics=True)
    e = uc.add(NewExperimentInput(name="x"))
    uc.record_history([MetricPoint(e.id, "loss", 0, 1.0), MetricPoint(e.id, "loss", 1, 0.8)])
    hist = metrics.history(e.id, "loss")
    assert [p.value for p in hist] == [1.0, 0.8]


def test_record_history_without_repo_raises():
    _, _, uc = make_uc(with_metrics=False)
    e = uc.add(NewExperimentInput(name="x"))
    with pytest.raises(ExperimentValidationError):
        uc.record_history([MetricPoint(e.id, "loss", 0, 1.0)])


def test_mutate_missing_raises():
    _, _, uc = make_uc()
    with pytest.raises(ExperimentValidationError):
        uc.set_status("nope", "done")


def test_short_sha():
    assert short_sha("a1b2c3d4e5f6") == "a1b2c3d"
    assert short_sha(None) is None

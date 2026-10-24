"""Restarting a run clears its curves through the metric port (review 43-08).

``clear`` used to be found with ``getattr``: the PostgREST adapter had none, so
a restart kept the old curves, and the API adapter's curves went before the
experiment row was saved, so a failed save left the old row without them.
"""

import pytest

from weaveforge import NewExperimentInput
from weaveforge.features.experiments.application import ManageExperimentUseCase
from weaveforge.features.experiments.domain.metric_point import MetricPoint
from weaveforge.features.experiments.domain.metric_repository import IMetricRepository
from weaveforge.features.experiments.infrastructure.postgrest_metric_repository import (
    PostgrestMetricRepository,
)
from weaveforge.testing import (
    FixedClock,
    InMemoryExperimentRepository,
    InMemoryMetricRepository,
    SeqIdGenerator,
)

ISO = "2026-01-01T00:00:00Z"


class _Query:
    def __init__(self, table, log):
        self._table = table
        self._log = log

    def delete(self):
        self._log.append(("delete", self._table))
        return self

    def eq(self, col, val):
        self._log.append(("eq", self._table, col, val))
        return self

    def execute(self):
        self._log.append(("execute", self._table))
        return None


class _Client:
    def __init__(self):
        self.log = []

    def table(self, name):
        return _Query(name, self.log)


def test_port_requires_clear():
    class NoClear:
        def append(self, points, *, timeout=None): ...
        def history(self, experiment_id, metric=None): return []

    assert not isinstance(NoClear(), IMetricRepository)
    assert isinstance(InMemoryMetricRepository(), IMetricRepository)
    assert isinstance(PostgrestMetricRepository(_Client()), IMetricRepository)


def test_postgrest_clear_deletes_both_stores_for_that_run_only():
    client = _Client()
    PostgrestMetricRepository(client).clear("run-1")

    # Straight from the two base tables, as the ingest route does: the view's
    # delete trigger would run once per point.
    for table in ("experiment_metric_points", "experiment_metric_chunks"):
        assert ("delete", table) in client.log
        assert ("eq", table, "experiment_id", "run-1") in client.log
        assert ("execute", table) in client.log
    assert {e[1] for e in client.log} == {"experiment_metric_points", "experiment_metric_chunks"}


class _FailingSave(InMemoryExperimentRepository):
    fail = False

    def save(self, entity):
        if self.fail:
            raise RuntimeError("database down")
        super().save(entity)


def test_failed_restart_keeps_the_old_curves():
    repo = _FailingSave()
    metrics = InMemoryMetricRepository()
    uc = ManageExperimentUseCase(repo, FixedClock(ISO), SeqIdGenerator(), metrics)
    uc.upsert(NewExperimentInput(name="a", status="running"), "key-id")
    uc.record_history([MetricPoint("key-id", "loss", 0, 1.0)])

    repo.fail = True
    with pytest.raises(RuntimeError):
        uc.upsert(NewExperimentInput(name="b", status="running"), "key-id")

    assert [p.value for p in metrics.history("key-id")] == [1.0]


def test_restart_clears_only_that_run():
    metrics = InMemoryMetricRepository()
    uc = ManageExperimentUseCase(
        InMemoryExperimentRepository(), FixedClock(ISO), SeqIdGenerator(), metrics
    )
    uc.upsert(NewExperimentInput(name="a"), "one")
    uc.upsert(NewExperimentInput(name="b"), "two")
    uc.record_history([MetricPoint("one", "loss", 0, 1.0), MetricPoint("two", "loss", 0, 2.0)])

    uc.upsert(NewExperimentInput(name="a again"), "one")

    assert metrics.history("one") == []
    assert [p.value for p in metrics.history("two")] == [2.0]


def test_first_upsert_clears_nothing():
    metrics = InMemoryMetricRepository()
    metrics.append([MetricPoint("new", "loss", 0, 1.0)])
    uc = ManageExperimentUseCase(
        InMemoryExperimentRepository(), FixedClock(ISO), SeqIdGenerator(), metrics
    )

    uc.upsert(NewExperimentInput(name="a"), "new")

    assert len(metrics.history("new")) == 1

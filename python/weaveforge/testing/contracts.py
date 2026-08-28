"""Shared repository contract suites.

Each function asserts the behavioural contract of an interface against a
caller-supplied factory, so the *same* checks run against the in-memory and the
Supabase implementations (Liskov — ``docs/building/design.md`` §6). Integration tests
pass a factory that builds the Supabase repo; unit tests pass the in-memory one.
"""

from __future__ import annotations

from collections.abc import Callable

from ..features.experiments.domain.experiment import Experiment
from ..features.experiments.domain.experiment_repository import IExperimentRepository
from ..features.experiments.domain.metric_point import MetricPoint
from ..features.experiments.domain.metric_repository import IMetricRepository


def _experiment(id: str, name: str, **kw) -> Experiment:
    return Experiment(
        id=id, name=name, status=kw.pop("status", "planned"),
        created_at=kw.pop("created_at", "2026-06-24T12:00:00.000Z"), **kw
    )


def check_experiment_repository(make: Callable[[], IExperimentRepository]) -> None:
    repo = make()

    assert repo.get_by_id("missing") is None

    a = _experiment("a", "beta-vae", created_at="2026-06-01T00:00:00.000Z")
    b = _experiment("b", "gamma-run", status="running",
                    created_at="2026-06-02T00:00:00.000Z")
    repo.save(a)
    repo.save(b)

    got = repo.get_by_id("a")
    assert got is not None and got.name == "beta-vae"

    # Newest-first ordering.
    names = [e.id for e in repo.list()]
    assert names[0] == "b" and names[1] == "a"

    # Filters.
    from ..features.experiments.domain.experiment import ExperimentFilter

    assert [e.id for e in repo.list(ExperimentFilter(status="running"))] == ["b"]
    assert [e.id for e in repo.list(ExperimentFilter(name_contains="BETA"))] == ["a"]

    # Upsert on save.
    a.name = "beta-vae v2"
    repo.save(a)
    updated = repo.get_by_id("a")
    assert updated is not None and updated.name == "beta-vae v2"

    repo.delete("a")
    assert repo.get_by_id("a") is None


def check_metric_repository(
    make: Callable[[], IMetricRepository], experiment_id: str = "exp-1"
) -> None:
    repo = make()

    assert repo.history(experiment_id) == []

    repo.append([
        MetricPoint(experiment_id, "loss", 1, 0.9),
        MetricPoint(experiment_id, "loss", 0, 1.0),
        MetricPoint(experiment_id, "acc", 0, 0.5),
    ])

    loss = repo.history(experiment_id, "loss")
    assert [p.step for p in loss] == [0, 1]
    assert [p.value for p in loss] == [1.0, 0.9]

    everything = repo.history(experiment_id)
    assert {p.metric for p in everything} == {"loss", "acc"}

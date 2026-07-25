"""Run the shared contract suites against the in-memory implementations."""

from thesis_tracker.testing import (
    InMemoryExperimentRepository,
    InMemoryMetricRepository,
)
from thesis_tracker.testing.contracts import (
    check_experiment_repository,
    check_metric_repository,
)


def test_in_memory_experiment_repository_contract():
    check_experiment_repository(InMemoryExperimentRepository)


def test_in_memory_metric_repository_contract():
    check_metric_repository(InMemoryMetricRepository)

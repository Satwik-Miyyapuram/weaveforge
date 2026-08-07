"""experiments — the public API of the experiments feature module.

Others import from here, never from the internals (``docs/DESIGN.md`` §3.1).
The Supabase adapters in ``infrastructure`` are intentionally *not* re-exported:
they are wired only at the composition root (``weaveforge.container``).
"""

from .application import ManageExperimentUseCase
from .domain import (
    EXPERIMENT_STATUSES,
    Experiment,
    ExperimentFilter,
    ExperimentStatus,
    ExperimentValidationError,
    IExperimentRepository,
    IMetricRepository,
    MetricPoint,
    MetricSeries,
    NewExperimentInput,
    create_experiment,
    short_sha,
)

__all__ = [
    "Experiment",
    "ExperimentStatus",
    "EXPERIMENT_STATUSES",
    "NewExperimentInput",
    "ExperimentFilter",
    "ExperimentValidationError",
    "create_experiment",
    "short_sha",
    "IExperimentRepository",
    "IMetricRepository",
    "MetricPoint",
    "MetricSeries",
    "ManageExperimentUseCase",
]

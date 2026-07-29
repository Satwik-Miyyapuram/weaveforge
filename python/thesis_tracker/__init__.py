"""thesis_tracker — Python SDK for Thesis Tracker.

Push experiments, training curves, and figures into the same Supabase database
the PWA reads, using the decorator as the one entry point::

    from thesis_tracker import track_experiment

    @track_experiment(name="beta-vae sweep", config={"beta": 4}, sync=["tensorboard"])
    def train(run):
        run.log_metric("val_loss", 0.11, step=100)
        run.log_figure(fig, name="reconstruction")
        return {"val_loss": 0.11}          # recorded as summary metrics

Mirrors the web app's modular shape (``features/<name>/...``); the Supabase
migrations are the shared source of truth (see ``docs/DESIGN.md`` §5.4).
"""

from .features.experiments import (
    EXPERIMENT_STATUSES,
    Experiment,
    ExperimentStatus,
    ExperimentValidationError,
    ManageExperimentUseCase,
    MetricPoint,
    MetricSeries,
    NewExperimentInput,
    short_sha,
)
from .tracking import track, track_experiment

# Hatch reads this as the package version (see pyproject [tool.hatch.version]).
# The PyPI publish runs off the repo's vX.Y.Z tag, so this must be bumped in
# step with it — PyPI refuses a re-upload of a version it already has.
__version__ = "0.5.0"

__all__ = [
    "Experiment",
    "ExperimentStatus",
    "EXPERIMENT_STATUSES",
    "NewExperimentInput",
    "ExperimentValidationError",
    "ManageExperimentUseCase",
    "MetricPoint",
    "MetricSeries",
    "short_sha",
    "track",
    "track_experiment",
    "Run",
    "connect",
    "Container",
    "Settings",
    "__version__",
]


def __getattr__(name: str):
    """Lazily expose the connection layer so ``import thesis_tracker`` (and the
    decorator) work without the ``supabase`` package installed — it's only
    needed when you actually ``connect()``."""
    if name == "Run":
        from .features.experiments.application.run import Run

        return Run
    if name in ("connect", "Container"):
        from . import container as _c

        return getattr(_c, name)
    if name == "Settings":
        from .config import Settings

        return Settings
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

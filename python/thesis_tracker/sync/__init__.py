"""Pluggable sync sources — the extension seam.

A ``MetricSource`` reads training curves out of some logger (TensorBoard,
wandb, …) and an ``ArtifactSource`` produces files/links (matplotlib figures,
run URLs). Both are plain protocols, and a :class:`SyncRegistry` resolves them
by id, so adding a new logger is a *new class that self-registers* — never an
edit to the ``Run`` or the use-case (Open/Closed; mirrors the paper
``IMetadataSource`` resolver in ``docs/DESIGN.md`` §5.2).

Concrete sources live in sibling modules and are imported lazily (they pull in
heavy optional deps), so importing ``thesis_tracker.sync`` stays cheap.
"""

# Import the built-in sources so they self-register with ``default_registry``.
# Each import is cheap: the heavy dep (matplotlib / tbparse / wandb) is only
# imported when the source actually runs, so a source stays registered-but-
# unavailable until its extra is installed.
from . import matplotlib as _matplotlib  # noqa: E402,F401
from . import tensorboard as _tensorboard  # noqa: E402,F401
from . import wandb as _wandb  # noqa: E402,F401
from .registry import SyncRegistry, default_registry
from .source import (
    Artifact,
    ArtifactSource,
    MetricSource,
    MissingDependencyError,
    SyncError,
)

__all__ = [
    "Artifact",
    "ArtifactSource",
    "MetricSource",
    "SyncError",
    "MissingDependencyError",
    "SyncRegistry",
    "default_registry",
]

"""An in-memory stand-in for the Supabase :class:`Container`, so the ``Run`` /
decorator / context-manager can be driven end-to-end in unit tests with no
network (Liskov: same surface the real container exposes to ``track``)."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..features.experiments.application.manage_experiment import ManageExperimentUseCase
from .fakes import FixedClock, SeqIdGenerator
from .in_memory_experiment_repository import InMemoryExperimentRepository
from .in_memory_metric_repository import InMemoryMetricRepository


class MemoryArtifactStorage:
    """Records uploaded bytes and hands back a deterministic fake URL."""

    def __init__(self) -> None:
        self.uploaded: dict[str, bytes] = {}

    def upload(
        self,
        experiment_id: str,
        name: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        path = f"{experiment_id}/{name}"
        self.uploaded[path] = data
        return f"memory://{path}"


@dataclass
class MemoryContainer:
    experiments: InMemoryExperimentRepository = field(default_factory=InMemoryExperimentRepository)
    metrics: InMemoryMetricRepository = field(default_factory=InMemoryMetricRepository)
    artifacts: MemoryArtifactStorage = field(default_factory=MemoryArtifactStorage)
    manage_experiment: ManageExperimentUseCase = field(init=False)

    def __post_init__(self) -> None:
        self.manage_experiment = ManageExperimentUseCase(
            self.experiments, FixedClock(), SeqIdGenerator(), self.metrics
        )

"""Test doubles + shared contract suites.

In-memory repositories stand in for the Supabase ones (Liskov); the contract
functions here are run against *every* implementation so behaviour is identical
from the caller's view (``docs/DESIGN.md`` §6).
"""

from .fakes import FixedClock, SeqIdGenerator
from .in_memory_experiment_repository import InMemoryExperimentRepository
from .in_memory_metric_repository import InMemoryMetricRepository
from .memory_container import MemoryArtifactStorage, MemoryContainer

__all__ = [
    "FixedClock",
    "SeqIdGenerator",
    "InMemoryExperimentRepository",
    "InMemoryMetricRepository",
    "MemoryContainer",
    "MemoryArtifactStorage",
]

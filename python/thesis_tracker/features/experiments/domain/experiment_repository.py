"""Repository contract for experiments (DIP). Port of
``experiment-repository.ts`` — read + write halves of the generic contract."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .experiment import Experiment, ExperimentFilter


@runtime_checkable
class IExperimentRepository(Protocol):
    def get_by_id(self, id: str) -> Experiment | None: ...

    def list(self, filter: ExperimentFilter | None = None) -> list[Experiment]: ...

    def save(self, entity: Experiment) -> None: ...

    def delete(self, id: str) -> None: ...

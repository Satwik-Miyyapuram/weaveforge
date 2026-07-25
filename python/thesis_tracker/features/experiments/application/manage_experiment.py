"""Use-case for experiments. Orchestration only (DIP): add, change status
(stamping started/finished timestamps), record summary metrics, and append
step-indexed history. Port of ``manage-experiment.use-case.ts``, extended with
``record_history`` for the metric-curve table (0016).
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ....shared.clock import Clock, IdGenerator
from ..domain.experiment import (
    Experiment,
    ExperimentStatus,
    ExperimentValidationError,
    NewExperimentInput,
    create_experiment,
)
from ..domain.experiment_repository import IExperimentRepository
from ..domain.metric_point import MetricPoint
from ..domain.metric_repository import IMetricRepository

_TERMINAL: tuple[ExperimentStatus, ...] = ("done", "failed", "abandoned")


class ManageExperimentUseCase:
    def __init__(
        self,
        repository: IExperimentRepository,
        clock: Clock,
        ids: IdGenerator,
        metrics: IMetricRepository | None = None,
    ) -> None:
        self._repo = repository
        self._clock = clock
        self._ids = ids
        self._metrics = metrics

    def add(self, data: NewExperimentInput) -> Experiment:
        exp = create_experiment(data, clock=self._clock, ids=self._ids)
        self._repo.save(exp)
        return exp

    def set_status(
        self,
        id: str,
        status: ExperimentStatus,
        *,
        existing: Experiment | None = None,
    ) -> Experiment:
        def change(e: Experiment) -> Experiment:
            now = self._clock.now_iso()
            e.status = status
            if status == "running" and not e.started_at:
                e.started_at = now
            if status in _TERMINAL:
                e.finished_at = now
            return e

        return self._mutate(id, change, existing=existing)

    def record_metrics(
        self,
        id: str,
        metrics: dict[str, Any],
        *,
        existing: Experiment | None = None,
    ) -> Experiment:
        def change(e: Experiment) -> Experiment:
            e.metrics = {**e.metrics, **metrics}
            return e

        return self._mutate(id, change, existing=existing)

    def add_artifacts(
        self,
        id: str,
        links: Iterable[str],
        *,
        existing: Experiment | None = None,
    ) -> Experiment:
        def change(e: Experiment) -> Experiment:
            existing_links = set(e.artifacts)
            for link in links:
                if link not in existing_links:
                    e.artifacts.append(link)
                    existing_links.add(link)
            return e

        return self._mutate(id, change, existing=existing)

    def record_history(self, points: Iterable[MetricPoint]) -> None:
        if self._metrics is None:
            raise ExperimentValidationError(
                "No metric repository wired — cannot record step history."
            )
        self._metrics.append(points)

    def remove(self, id: str) -> None:
        self._repo.delete(id)

    def _mutate(self, id: str, change, *, existing: Experiment | None = None) -> Experiment:
        base = existing if existing is not None else self._repo.get_by_id(id)
        if base is None:
            raise ExperimentValidationError(f'No experiment with id "{id}".')
        updated = change(base)
        self._repo.save(updated)
        return updated

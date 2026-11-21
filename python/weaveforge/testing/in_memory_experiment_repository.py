"""In-memory :class:`IExperimentRepository` — port of
``in-memory-experiment-repository.ts``. Filtering + newest-first ordering match
the PostgREST adapter so the shared contract suite passes against both."""

from __future__ import annotations

import copy
from typing import Any

from ..features.experiments.domain.experiment import Experiment, ExperimentFilter
from ..features.experiments.infrastructure.experiment_row import to_domain, to_row


class InMemoryExperimentRepository:
    def __init__(self) -> None:
        self._store: dict[str, Experiment] = {}

    def get_by_id(self, id: str) -> Experiment | None:
        found = self._store.get(id)
        return copy.deepcopy(found) if found else None

    def list(self, filter: ExperimentFilter | None = None) -> list[Experiment]:
        items = [copy.deepcopy(e) for e in self._store.values()]
        if filter:
            if filter.status:
                items = [e for e in items if e.status == filter.status]
            if filter.related_paper:
                items = [e for e in items if e.related_paper == filter.related_paper]
            if filter.name_contains:
                needle = filter.name_contains.lower()
                items = [e for e in items if needle in e.name.lower()]
        items.sort(key=lambda e: e.created_at, reverse=True)
        return items

    def save(self, entity: Experiment) -> None:
        self._store[entity.id] = copy.deepcopy(entity)

    def save_fields(self, id: str, fields: dict[str, Any]) -> None:
        stored = self._store[id]
        self._store[id] = to_domain(copy.deepcopy({**to_row(stored), **fields}))

    def delete(self, id: str) -> None:
        self._store.pop(id, None)

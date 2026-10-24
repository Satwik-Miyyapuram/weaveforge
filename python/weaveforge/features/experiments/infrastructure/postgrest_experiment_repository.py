"""PostgREST adapter for :class:`IExperimentRepository`.

The ONLY experiments layer that talks to the database (DIP). The row mapping
(``to_row`` / ``to_domain``) lives in :mod:`.experiment_row`, shared with the
API adapter. Project scoping matches the web app's ``ProjectContext``.
"""

from __future__ import annotations

from typing import Any

from ..domain.experiment import Experiment, ExperimentFilter
from .experiment_row import to_domain, to_row

_TABLE = "experiments"


class PostgrestExperimentRepository:
    def __init__(self, client: Any, project_id: str | None = None) -> None:
        self._db = client
        self._pid = project_id

    def get_by_id(self, id: str) -> Experiment | None:
        res = self._db.table(_TABLE).select("*").eq("id", id).limit(1).execute()
        rows = res.data or []
        return to_domain(rows[0]) if rows else None

    def list(self, filter: ExperimentFilter | None = None) -> list[Experiment]:
        q = self._db.table(_TABLE).select("*")
        if self._pid:
            q = q.eq("project_id", self._pid)
        if filter:
            if filter.status:
                q = q.eq("status", filter.status)
            if filter.related_paper:
                q = q.eq("related_paper", filter.related_paper)
            if filter.name_contains:
                q = q.ilike("name", f"%{filter.name_contains}%")
        q = q.order("created_at", desc=True)
        res = q.execute()
        return [to_domain(r) for r in (res.data or [])]

    def save(self, entity: Experiment) -> None:
        row = to_row(entity)
        if self._pid:
            row["project_id"] = self._pid
        self._db.table(_TABLE).upsert(row).execute()

    def delete(self, id: str) -> None:
        self._db.table(_TABLE).delete().eq("id", id).execute()

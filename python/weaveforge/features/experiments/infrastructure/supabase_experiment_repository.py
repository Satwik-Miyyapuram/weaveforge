"""Supabase adapter for :class:`IExperimentRepository`.

The ONLY experiments layer that imports the Supabase SDK (DIP). ``to_row`` /
``to_domain`` mirror the TypeScript adapter's snake_case mapping so both clients
write identical rows. Project scoping matches the web app's ``ProjectContext``.
"""

from __future__ import annotations

from typing import Any

from ..domain.experiment import Experiment, ExperimentFilter

_TABLE = "experiments"


class SupabaseExperimentRepository:
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


def to_domain(r: dict[str, Any]) -> Experiment:
    return Experiment(
        id=r["id"],
        name=r["name"],
        status=r["status"],
        created_at=r["created_at"],
        hypothesis=r.get("hypothesis"),
        repo_url=r.get("repo_url"),
        commit_sha=r.get("commit_sha"),
        branch=r.get("branch"),
        run_command=r.get("run_command"),
        config=r.get("config") or {},
        metrics=r.get("metrics") or {},
        artifacts=r.get("artifacts") or [],
        result_note=r.get("result_note"),
        started_at=r.get("started_at"),
        finished_at=r.get("finished_at"),
        related_paper=r.get("related_paper"),
    )


def to_row(e: Experiment) -> dict[str, Any]:
    return {
        "id": e.id,
        "name": e.name,
        "hypothesis": e.hypothesis,
        "status": e.status,
        "repo_url": e.repo_url,
        "commit_sha": e.commit_sha,
        "branch": e.branch,
        "run_command": e.run_command,
        "config": e.config,
        "metrics": e.metrics,
        "artifacts": e.artifacts,
        "result_note": e.result_note,
        "started_at": e.started_at,
        "finished_at": e.finished_at,
        "related_paper": e.related_paper,
        "created_at": e.created_at,
    }

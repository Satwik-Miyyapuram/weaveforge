from __future__ import annotations

from typing import Any

from ....infrastructure.api_client import ApiClient
from ..domain.experiment import Experiment, ExperimentFilter


class ApiExperimentRepository:
    def __init__(self, api: ApiClient, project_id: str | None = None) -> None:
        self._api = api
        self._pid = project_id

    def get_by_id(self, id: str) -> Experiment | None:
        # Not needed by the SDK runtime today; keep for interface parity.
        res = self._api.get("/api/sdk/experiments", params={"id": id})
        row = res.get("experiment")
        return to_domain(row) if row else None

    def list(self, filter: ExperimentFilter | None = None) -> list[Experiment]:
        # Future extension: add list endpoint with filters.
        raise NotImplementedError("Listing experiments via API is not implemented yet.")

    def save(self, entity: Experiment) -> None:
        row = to_row(entity)
        if self._pid:
            row["project_id"] = self._pid
        self._api.post("/api/sdk/experiments", json=row)

    def delete(self, id: str) -> None:
        self._api.delete("/api/sdk/experiments", params={"id": id})


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


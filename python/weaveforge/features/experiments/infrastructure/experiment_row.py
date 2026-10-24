"""One experiments row mapping for every adapter (API and PostgREST).

``to_row`` / ``to_domain`` mirror the TypeScript adapter's snake_case mapping
so both clients write identical rows.
"""

from __future__ import annotations

from typing import Any

from ..domain.experiment import Experiment


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

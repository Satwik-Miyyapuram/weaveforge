"""Experiments domain model — pure, no I/O. An Experiment is one tracked run,
pinned to a code state (repo / branch / commit) like a git entry, with config
and metrics. Faithful port of
``packages/core/src/features/experiments/domain/experiment.ts`` — the schema in
``supabase/migrations/0009_experiments.sql`` is the shared source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, get_args

from ....shared.clock import Clock, IdGenerator

ExperimentStatus = Literal["planned", "running", "done", "failed", "abandoned"]

EXPERIMENT_STATUSES: tuple[ExperimentStatus, ...] = get_args(ExperimentStatus)


@dataclass
class Experiment:
    id: str
    name: str
    status: ExperimentStatus
    created_at: str
    hypothesis: str | None = None
    repo_url: str | None = None
    commit_sha: str | None = None
    branch: str | None = None
    run_command: str | None = None
    #: Hyperparameters / dataset / seed.
    config: dict[str, Any] = field(default_factory=dict)
    #: {"val_loss": 0.118, "mig": 0.41, ...} — flat summary values.
    metrics: dict[str, Any] = field(default_factory=dict)
    #: Links to checkpoints / plots (W&B, Storage, etc.).
    artifacts: list[str] = field(default_factory=list)
    result_note: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    #: Paper this run tests/implements.
    related_paper: str | None = None


@dataclass
class NewExperimentInput:
    name: str
    hypothesis: str | None = None
    status: ExperimentStatus | None = None
    repo_url: str | None = None
    commit_sha: str | None = None
    branch: str | None = None
    run_command: str | None = None
    config: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    artifacts: list[str] | None = None
    result_note: str | None = None
    related_paper: str | None = None


@dataclass
class ExperimentFilter:
    status: ExperimentStatus | None = None
    #: Case-insensitive substring match against name.
    name_contains: str | None = None
    related_paper: str | None = None


class ExperimentValidationError(Exception):
    pass


def create_experiment(
    data: NewExperimentInput, *, clock: Clock, ids: IdGenerator
) -> Experiment:
    name = (data.name or "").strip()
    if not name:
        raise ExperimentValidationError("Experiment name is required.")
    now = clock.now_iso()
    status: ExperimentStatus = data.status or "planned"
    return Experiment(
        id=ids.new_id(),
        name=name,
        hypothesis=data.hypothesis,
        status=status,
        repo_url=data.repo_url,
        commit_sha=data.commit_sha.strip() if data.commit_sha else None,
        branch=data.branch.strip() if data.branch else None,
        run_command=data.run_command,
        config=dict(data.config or {}),
        metrics=dict(data.metrics or {}),
        artifacts=list(data.artifacts or []),
        result_note=data.result_note,
        started_at=now if status == "running" else None,
        related_paper=data.related_paper,
        created_at=now,
    )


def short_sha(sha: str | None) -> str | None:
    """Short display form of a commit SHA."""
    return sha.strip()[:7] if sha else None

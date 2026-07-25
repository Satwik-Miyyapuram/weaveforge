"""Row<->domain mapping for the Supabase experiment adapter (no network)."""

from thesis_tracker.features.experiments.domain.experiment import Experiment
from thesis_tracker.features.experiments.infrastructure.supabase_experiment_repository import (
    to_domain,
    to_row,
)


def test_round_trip():
    e = Experiment(
        id="e1",
        name="beta-vae",
        status="running",
        created_at="2026-06-24T12:00:00.000Z",
        hypothesis="disentangles",
        repo_url="https://github.com/me/thesis",
        commit_sha="a1b2c3d",
        branch="main",
        config={"beta": 4},
        metrics={"val_loss": 0.11},
        artifacts=["https://x/plot.png"],
        started_at="2026-06-24T12:00:00.000Z",
    )
    back = to_domain(to_row(e))
    assert back == e


def test_to_domain_fills_missing_jsonb_defaults():
    row = {
        "id": "e2",
        "name": "x",
        "status": "planned",
        "created_at": "2026-06-24T12:00:00.000Z",
        # config / metrics / artifacts absent or null
        "config": None,
        "metrics": None,
        "artifacts": None,
    }
    e = to_domain(row)
    assert e.config == {} and e.metrics == {} and e.artifacts == []

"""Run + decorator + context-manager, driven against an in-memory container."""


import pytest

from weaveforge import track, track_experiment
from weaveforge.features.experiments.domain.metric_point import MetricSeries
from weaveforge.sync import SyncRegistry
from weaveforge.sync.source import Artifact
from weaveforge.testing import MemoryContainer


class FakeFigure:
    """Stands in for a matplotlib Figure — only savefig is used by Run."""

    def savefig(self, buf, format="png", **kw):
        buf.write(b"\x89PNG-fake-" + format.encode())


def test_decorator_runs_and_records(monkeypatch):
    c = MemoryContainer()
    # keep the test offline: no real git subprocess, no supabase connect
    monkeypatch.setattr("weaveforge.tracking.capture_git_state", lambda cwd=None: {})

    @track_experiment(name="beta-vae", config={"latent_dim": 32}, container=c)
    def train(beta, run):
        assert run.experiment.status == "running"
        for step in range(3):
            run.log_metric("loss", 1.0 - step * 0.1, step=step)
        return {"val_loss": 0.11}

    train(beta=4)

    exps = c.experiments.list()
    assert len(exps) == 1
    e = exps[0]
    assert e.status == "done" and e.finished_at is not None
    # hyperparam captured + explicit config both present
    assert e.config["beta"] == 4 and e.config["latent_dim"] == 32
    # summary has the return value and the last curve value
    assert e.metrics["val_loss"] == 0.11
    assert e.metrics["loss"] == pytest.approx(0.8)
    # full history persisted
    hist = c.metrics.history(e.id, "loss")
    assert [p.step for p in hist] == [0, 1, 2]


def test_context_manager_marks_failed_on_error(monkeypatch):
    c = MemoryContainer()
    monkeypatch.setattr("weaveforge.tracking.capture_git_state", lambda cwd=None: {})

    with pytest.raises(ValueError):
        with track("boom", container=c) as run:
            run.log_metric("loss", 1.0, step=0)
            raise ValueError("kaboom")

    e = c.experiments.list()[0]
    assert e.status == "failed" and e.finished_at is not None
    assert [p.step for p in c.metrics.history(e.id, "loss")] == [0]


def test_log_figure_uploads_and_links(monkeypatch):
    c = MemoryContainer()
    monkeypatch.setattr("weaveforge.tracking.capture_git_state", lambda cwd=None: {})

    with track("figs", container=c) as run:
        url = run.log_figure(FakeFigure(), name="recon")

    assert url.startswith("memory://")
    e = c.experiments.list()[0]
    assert url in e.artifacts
    assert any(k.endswith("recon.png") for k in c.artifacts.uploaded)


def test_sync_source_ingests_curves_and_artifacts(monkeypatch):
    c = MemoryContainer()
    monkeypatch.setattr("weaveforge.tracking.capture_git_state", lambda cwd=None: {})

    reg = SyncRegistry()

    class DemoSource:
        id = "demo"

        def available(self):
            return True

        def read(self, ref):
            s = MetricSeries("acc")
            s.add(0, 0.5)
            s.add(1, 0.9)
            return [s]

        def collect(self, ref):
            return [Artifact(name="run", url="https://wandb.ai/run/1")]

    reg.register(DemoSource())

    with track("synced", container=c, registry=reg, sync={"demo": "ignored-ref"}):
        pass

    e = c.experiments.list()[0]
    assert e.metrics["acc"] == 0.9
    assert "https://wandb.ai/run/1" in e.artifacts
    assert [p.value for p in c.metrics.history(e.id, "acc")] == [0.5, 0.9]

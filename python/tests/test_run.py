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


class RecordingMirror:
    """A mirror that keeps what it was told rather than sending it anywhere."""

    def __init__(self, name, config):
        self.name = name
        self.config = config
        self.logged = []
        self.finished = None

    def log(self, metrics, step):
        self.logged.append((dict(metrics), step))

    def finish(self, status):
        self.finished = status


class RecordingMirrorSource:
    id = "recorder"

    def __init__(self):
        self.opened = []

    def available(self):
        return True

    def open(self, *, name, config):
        mirror = RecordingMirror(name, config)
        self.opened.append(mirror)
        return mirror


def _no_git(monkeypatch):
    monkeypatch.setattr("weaveforge.tracking.capture_git_state", lambda cwd=None: {})


def test_a_mirrored_run_is_carried_along_and_closed_with_this_one(monkeypatch):
    _no_git(monkeypatch)
    source = RecordingMirrorSource()
    registry = SyncRegistry()
    registry.register(source)

    with track("mirrored", config={"lr": 0.1}, container=MemoryContainer(),
               registry=registry, mirror="recorder") as run:
        run.log_metric("loss", 0.5, step=0)
        run.log_metrics({"loss": 0.4, "acc": 0.9}, step=1)

    mirror = source.opened[0]
    assert mirror.name == "mirrored" and mirror.config == {"lr": 0.1}
    assert mirror.logged == [({"loss": 0.5}, 0), ({"loss": 0.4}, 1), ({"acc": 0.9}, 1)]
    assert mirror.finished == "done"


def test_a_failed_run_closes_its_mirror_as_failed(monkeypatch):
    _no_git(monkeypatch)
    source = RecordingMirrorSource()
    registry = SyncRegistry()
    registry.register(source)

    with pytest.raises(ValueError):
        with track("mirrored", container=MemoryContainer(), registry=registry,
                   mirror="recorder"):
            raise ValueError("training died")

    assert source.opened[0].finished == "failed"


def test_a_source_that_cannot_mirror_says_so_before_the_run_starts(monkeypatch):
    _no_git(monkeypatch)
    registry = SyncRegistry()

    class ReadOnly:
        id = "read-only"

        def available(self):
            return True

        def read(self, ref):
            return []

    registry.register(ReadOnly())
    with pytest.raises(TypeError):
        with track("x", container=MemoryContainer(), registry=registry, mirror="read-only"):
            pass

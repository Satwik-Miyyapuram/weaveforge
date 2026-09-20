"""Run + decorator + context-manager, driven against an in-memory container."""


import asyncio
import warnings

import pytest

from weaveforge import track, track_experiment
from weaveforge.features.experiments.domain.metric_point import MetricSeries
from weaveforge.sync import SyncRegistry
from weaveforge.sync.source import Artifact
from weaveforge.testing import InMemoryMetricRepository, MemoryContainer


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


class _RecordingApi:
    """Stands in for the ApiClient just far enough to see whether it is closed."""

    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


def _container_with_api():
    container = MemoryContainer()
    api = _RecordingApi()
    container.api = api  # the real Container has this field; the memory one does not
    return container, api


def test_track_closes_the_connection_it_opened_for_itself(monkeypatch):
    _no_git(monkeypatch)
    container, api = _container_with_api()
    monkeypatch.setattr("weaveforge.tracking._connect", lambda project=None: container)

    with track("owned") as run:
        run.log_metric("loss", 1.0, step=0)

    # Every track() used to leak an httpx pool because nothing called close().
    assert api.closed is True


def test_track_closes_its_own_connection_even_when_the_run_raised(monkeypatch):
    _no_git(monkeypatch)
    container, api = _container_with_api()
    monkeypatch.setattr("weaveforge.tracking._connect", lambda project=None: container)

    with pytest.raises(ValueError):
        with track("owned"):
            raise ValueError("training died")

    assert api.closed is True


def test_track_leaves_an_injected_container_open(monkeypatch):
    """The caller opened that connection, so the caller closes it — and may
    still hold the ``Run`` afterwards."""
    _no_git(monkeypatch)
    container, api = _container_with_api()

    with track("injected", container=container) as run:
        run.log_metric("loss", 1.0, step=0)

    assert api.closed is False
    # The run is still usable in the only sense that matters after the block.
    assert container.experiments.list()[0].status == "done"


# --- exit paths -------------------------------------------------------------
#
# Every one of these is a way the run used to be left behind: still `running`
# because the send failed after the body succeeded, or an open connection or
# mirror because the experiment could not be created at all.


class _RefusingMetrics(InMemoryMetricRepository):
    """The server is gone by the time the run tries to send."""

    def append(self, points, *, timeout=None):  # type: ignore[override]
        raise ConnectionError("no route to host")


def _explode(*_args, **_kwargs):
    raise RuntimeError("the experiment could not be created")


def test_a_failing_send_on_the_success_path_still_ends_the_run(monkeypatch):
    """The success path used to be unguarded: `sync`, `flush` and only then the
    status, so one failed send left the experiment marked ``running`` for ever.
    The status is now written under a guard, and the send error is re-raised
    because on this path there is no earlier exception to protect."""
    _no_git(monkeypatch)
    container = MemoryContainer(metrics=_RefusingMetrics())

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        with pytest.raises(ConnectionError):
            with track("send-flaky", container=container) as run:
                run.log_metric("loss", 1.0, step=0)

    experiment = container.experiments.list()[0]
    assert experiment.status == "done", "training succeeded; only the send did not"
    assert experiment.finished_at is not None
    assert any("could not send metrics" in str(w.message) for w in caught)


def test_a_failing_send_on_the_failure_path_keeps_the_training_error(monkeypatch):
    _no_git(monkeypatch)
    container = MemoryContainer(metrics=_RefusingMetrics())

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        with pytest.raises(ValueError, match="training died"):
            with track("crashy", container=container) as run:
                run.log_metric("loss", 1.0, step=0)  # something for the flush to send
                raise ValueError("training died")

    experiment = container.experiments.list()[0]
    assert experiment.status == "failed"
    assert any("could not send metrics" in str(w.message) for w in caught)


def test_a_run_that_could_not_be_created_still_closes_the_connection(monkeypatch):
    """`_start_run` used to sit above the `try`, so anything it raised — a
    rejected token, a missing project, a mirror that cannot mirror — skipped the
    `finally` that closes the pool this call opened."""
    _no_git(monkeypatch)
    container, api = _container_with_api()
    monkeypatch.setattr("weaveforge.tracking._connect", lambda project=None: container)
    monkeypatch.setattr(container.manage_experiment, "add", _explode)

    with pytest.raises(RuntimeError, match="could not be created"):
        with track("owned"):
            pass

    assert api.closed is True


def test_a_mirror_is_released_when_the_experiment_cannot_be_created(monkeypatch):
    """The mirror is evaluated before the run is built, so a failure in between
    left a live run open on somebody else's service with nothing left to close
    it."""
    _no_git(monkeypatch)
    source = RecordingMirrorSource()
    registry = SyncRegistry()
    registry.register(source)
    container = MemoryContainer()
    monkeypatch.setattr(container.manage_experiment, "add", _explode)

    with pytest.raises(RuntimeError):
        with track("mirrored", container=container, registry=registry, mirror="recorder"):
            pass

    assert source.opened[0].finished == "failed"


def test_a_crash_whose_flush_also_fails_still_finishes_the_mirror(monkeypatch):
    """`Run.set_status` is the only thing that ever closes a mirror, and the
    failure path used to flush first — so a dead network left the mirrored run
    open as well as the row marked ``running``."""
    _no_git(monkeypatch)
    source = RecordingMirrorSource()
    registry = SyncRegistry()
    registry.register(source)
    container = MemoryContainer(metrics=_RefusingMetrics())

    with warnings.catch_warnings(record=True):
        warnings.simplefilter("always")
        with pytest.raises(ValueError):
            with track(
                "mirrored", container=container, registry=registry, mirror="recorder"
            ):
                raise ValueError("training died")

    assert source.opened[0].finished == "failed"
    assert container.experiments.list()[0].status == "failed"


def test_the_decorator_tracks_an_async_function(monkeypatch):
    """A synchronous wrapper around a coroutine function stamps the run `done`
    before a single step has run, and records no summary — silently."""
    _no_git(monkeypatch)
    container = MemoryContainer()

    @track_experiment(name="async-run", container=container)
    async def train(run, beta=1.0):
        assert run.experiment.status == "running"
        run.log_metric("loss", 0.5, step=0)
        return {"val_loss": 0.25}

    assert asyncio.run(train()) == {"val_loss": 0.25}

    experiment = container.experiments.list()[0]
    assert experiment.status == "done"
    assert experiment.metrics["val_loss"] == 0.25
    assert [p.step for p in container.metrics.history(experiment.id, "loss")] == [0]


def test_the_decorator_captures_positional_arguments(monkeypatch):
    """Hyperparameters used to be read from `kwargs` alone, so the same call
    captured its config or did not depending on the caller's style."""
    _no_git(monkeypatch)
    container = MemoryContainer()

    @track_experiment(name="positional", container=container)
    def train(beta, run):
        assert run.experiment.status == "running"

    train(4)

    assert container.experiments.list()[0].config["beta"] == 4


def test_the_decorator_does_not_inject_a_run_the_caller_already_passed(monkeypatch):
    """`kwargs.setdefault` only guards the keyword namespace: a caller passing
    the run positionally got `TypeError: got multiple values for argument`."""
    _no_git(monkeypatch)
    container = MemoryContainer()
    mine = object()

    @track_experiment(name="explicit", container=container)
    def train(run):
        return run is mine

    assert train(mine) is True


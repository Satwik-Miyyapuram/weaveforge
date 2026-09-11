"""Framework-callback plumbing (offline — scalar extraction and the failure
path every callback shares)."""

import pytest

from weaveforge.integrations._common import RunSession, to_scalars
from weaveforge.testing import MemoryContainer


class _FakeTensor:
    """Mimics a torch/numpy scalar with .item()."""

    def __init__(self, v):
        self._v = v

    def item(self):
        return self._v


def test_to_scalars_handles_tensors_floats_and_skips_junk():
    logs = {
        "loss": _FakeTensor(0.5),
        "acc": 0.9,
        "epoch": 3,
        "flag": True,          # bool -> skipped
        "name": "run",         # str -> skipped
        "arr": object(),       # no .item() -> skipped
    }
    out = to_scalars(logs)
    assert out == {"loss": 0.5, "acc": 0.9, "epoch": 3.0}


def test_to_scalars_none():
    assert to_scalars(None) == {}


# --- the failure path every callback shares --------------------------------
#
# Lightning reaches it through `on_exception`; Keras 3 has no exception hook at
# all, so its callback exposes `close(exc)` instead (see the module docstring in
# weaveforge/integrations/keras.py). Both end in `RunSession.finish(exc)`, which
# is what these tests drive directly — no framework install needed for these.


def _no_git(monkeypatch):
    monkeypatch.setattr("weaveforge.tracking.capture_git_state", lambda cwd=None: {})


def test_a_session_closed_with_an_exception_records_the_run_as_failed(monkeypatch):
    _no_git(monkeypatch)
    container = MemoryContainer()
    session = RunSession("keras-run", container=container)
    run = session.start()
    run.log_metric("loss", 1.0, step=0)

    # `finish(exc)` hands the exception to the `track` context manager, which
    # records the failure and flushes — and does not re-raise it at the caller
    # (the caller is already handling it).
    session.finish(RuntimeError("fit blew up"))

    experiment = container.experiments.list()[0]
    assert experiment.status == "failed"
    assert [p.step for p in container.metrics.history(experiment.id, "loss")] == [0]


def test_finishing_a_session_twice_does_nothing_the_second_time(monkeypatch):
    _no_git(monkeypatch)
    container = MemoryContainer()
    session = RunSession("keras-run", container=container)
    session.start()
    session.finish()
    assert container.experiments.list()[0].status == "done"

    # A callback may be closed by `on_train_end` *and* by the caller's `except`;
    # the second one must not reopen or re-stamp the run.
    session.finish(RuntimeError("too late"))
    assert [e.status for e in container.experiments.list()] == ["done"]


def test_the_keras_callback_offers_the_same_failure_hook_as_lightning(monkeypatch):
    pytest.importorskip("keras")  # the package must also have a working backend
    from weaveforge.integrations.keras import WeaveForgeCallback

    _no_git(monkeypatch)
    container = MemoryContainer()
    callback = WeaveForgeCallback(name="cnn", container=container)
    callback.on_train_begin()
    callback.on_epoch_end(0, {"loss": 1.0})

    # What a caller writes around a `fit` that raises. It must not raise in
    # turn, and must not leave the run behind as `running`.
    callback.close(RuntimeError("fit blew up"))

    experiment = container.experiments.list()[0]
    assert experiment.status == "failed"
    assert [p.step for p in container.metrics.history(experiment.id, "loss")] == [0]
    # `on_train_end` after an explicit close is a no-op, not a second ending.
    callback.on_train_end()
    assert [e.status for e in container.experiments.list()] == ["failed"]

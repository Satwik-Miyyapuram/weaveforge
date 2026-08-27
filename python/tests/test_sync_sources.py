"""Sync sources: registration, and their pure parsing transforms (offline)."""


from weaveforge.sync import default_registry
from weaveforge.sync.matplotlib import _render_figure
from weaveforge.sync.tensorboard import _scalars_to_series
from weaveforge.sync.wandb import _history_to_series


def test_builtin_sources_registered():
    for source_id in ("matplotlib", "tensorboard", "wandb"):
        assert default_registry.has(source_id)
        # available() must answer without the heavy dep installed
        assert isinstance(default_registry.get(source_id).available(), bool)


class _FakeFig:
    def savefig(self, buf, format="png", **kw):
        buf.write(b"PNG:" + format.encode())


def test_render_figure_png_fallback():
    art = _render_figure(_FakeFig(), 2, prefer_webp=False)
    assert art.name == "figure-2.png"
    assert art.content_type == "image/png"
    assert art.data == b"PNG:png"
    assert art.url is None


def test_tensorboard_grouping_and_ordering():
    rows = [
        ("loss", 1, 0.5, "t1"),
        ("loss", 0, 1.0, "t0"),
        ("acc", 0, 0.2, None),
    ]
    series = {s.metric: s for s in _scalars_to_series(rows)}
    assert set(series) == {"loss", "acc"}
    # sorted by step
    assert [p[0] for p in series["loss"].points] == [0, 1]
    assert series["loss"].last_value == 0.5


def test_wandb_history_skips_internal_and_nonnumeric():
    rows = [
        {"_step": 0, "_timestamp": 100, "loss": 1.0, "note": "hi", "flag": True},
        {"_step": 1, "_timestamp": 101, "loss": 0.5, "acc": 0.9},
    ]
    series = {s.metric: s for s in _history_to_series(rows)}
    # "note" (str) and "flag" (bool) excluded; only numeric metrics kept
    assert set(series) == {"loss", "acc"}
    assert [p[1] for p in series["loss"].points] == [1.0, 0.5]
    assert series["loss"].points[0][0] == 0


def test_matplotlib_source_available_is_bool():
    src = default_registry.get("matplotlib")
    assert isinstance(src.available(), bool)


class _AngryRun:
    """A W&B run that has lost its connection and says so, loudly, every time."""

    url = "https://wandb.ai/e/p/r"

    def __init__(self):
        self.calls = 0

    def log(self, metrics, step=None):
        self.calls += 1
        raise RuntimeError("network is gone")

    def finish(self, exit_code=0):
        raise RuntimeError("still gone")


def test_a_mirror_that_cannot_reach_wandb_stops_instead_of_raising():
    from weaveforge.sync.wandb import _WandbMirror

    run = _AngryRun()
    mirror = _WandbMirror(run)
    mirror.log({"loss": 1.0}, 0)
    # Switched off after the first failure: the loop is not paying for a retry
    # per step for the rest of the run.
    mirror.log({"loss": 0.9}, 1)
    assert run.calls == 1
    assert mirror.url is None
    mirror.finish("done")


class _HappyRun:
    url = "https://wandb.ai/e/p/r"

    def __init__(self):
        self.logged = []
        self.exit_code = None

    def log(self, metrics, step=None):
        self.logged.append((metrics, step))

    def finish(self, exit_code=0):
        self.exit_code = exit_code


def test_a_mirrored_run_ends_with_the_exit_code_wandb_expects():
    from weaveforge.sync.wandb import _WandbMirror

    run = _HappyRun()
    mirror = _WandbMirror(run)
    mirror.log({"loss": 1.0}, 3)
    assert run.logged == [({"loss": 1.0}, 3)]
    mirror.finish("failed")
    assert run.exit_code == 1

    other = _HappyRun()
    done = _WandbMirror(other)
    done.finish("done")
    done.finish("done")  # closed once, whatever else calls it
    assert other.exit_code == 0

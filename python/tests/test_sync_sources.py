"""Sync sources: registration, and their pure parsing transforms (offline)."""

from datetime import datetime, timezone

from weaveforge.features.experiments.domain.metric_point import normalize_wall_time
from weaveforge.sync import default_registry
from weaveforge.sync.matplotlib import _render_figure
from weaveforge.sync.tensorboard import _scalars_to_series
from weaveforge.sync.wandb import _history_to_series


def _assert_iso8601(value: str) -> datetime:
    """The value has to survive a real timestamp parse — that is what Postgres
    does to a ``timestamptz`` column, and a numeric string does not survive it."""
    assert isinstance(value, str)
    # `datetime.fromisoformat` only learned the `Z` suffix in 3.11; this package
    # supports 3.10.
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    return parsed


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


#: A realistic wandb `_timestamp`: epoch **seconds**, fractional — the value that
#: used to arrive at Postgres as the string "1699999999.123456" and be rejected.
_EPOCH = 1699999999.123456


def test_wandb_wall_time_is_a_parseable_timestamp_not_epoch_seconds_text():
    rows = [{"_step": 0, "_timestamp": _EPOCH, "loss": 1.0}]
    series = _history_to_series(rows)
    wall = series[0].points[0][2]
    # Raw epoch seconds stay raw: nothing on this path stringifies them.
    assert wall == _EPOCH
    assert _assert_iso8601(normalize_wall_time(wall)) == datetime.fromtimestamp(
        _EPOCH, tz=timezone.utc
    )


def test_wandb_points_carry_an_iso_wall_time_through_to_metric_points():
    """The entity is what gets serialized into the request body, so assert *its*
    `wall_time` parses — the assertion the original test was missing."""
    rows = [{"_step": 0, "_timestamp": _EPOCH, "loss": 1.0}]
    series = _history_to_series(rows)
    [point] = list(series[0].to_points("exp-1"))
    assert point.wall_time is not None
    assert _assert_iso8601(point.wall_time) == datetime.fromtimestamp(
        _EPOCH, tz=timezone.utc
    )


def test_tensorboard_wall_time_keeps_the_raw_epoch_seconds():
    rows = [("loss", 0, 1.0, _EPOCH), ("loss", 1, 0.5, None)]
    series = {s.metric: s for s in _scalars_to_series(rows)}
    wall = series["loss"].points[0][2]
    assert wall == _EPOCH
    point = next(series["loss"].to_points("exp-1"))
    assert point.wall_time is not None
    assert _assert_iso8601(point.wall_time) == datetime.fromtimestamp(
        _EPOCH, tz=timezone.utc
    )
    # A source with no wall clock still round-trips as None.
    assert normalize_wall_time(series["loss"].points[1][2]) is None


def test_normalize_wall_time_converts_a_numeric_string_but_not_a_real_timestamp():
    # The shape a `str(epoch_float)` caller produces — accepted defensively,
    # because that is exactly the mistake that shipped in the wandb source.
    assert _assert_iso8601(normalize_wall_time(str(_EPOCH))) == datetime.fromtimestamp(
        _EPOCH, tz=timezone.utc
    )
    assert _assert_iso8601(normalize_wall_time(1699999999)) == datetime.fromtimestamp(
        1699999999, tz=timezone.utc
    )
    # An ISO string is already parseable and must not be read as seconds since 1970.
    for iso in (
        "2026-06-24T12:00:00.000Z",
        "2026-06-24T12:00:00+00:00",
        "2026-06-24",
    ):
        assert normalize_wall_time(iso) == iso
    # Basic-format dates are numeric strings too, and 8/14 digits is not an epoch.
    assert normalize_wall_time("20260624") == "20260624"
    assert normalize_wall_time("20260624120000") == "20260624120000"
    assert normalize_wall_time(None) is None
    assert normalize_wall_time(True) is None


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

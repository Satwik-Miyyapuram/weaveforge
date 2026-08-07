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

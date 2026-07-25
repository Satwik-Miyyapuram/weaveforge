"""Framework-callback plumbing (offline — the pure scalar extraction)."""

from thesis_tracker.integrations._common import to_scalars


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

"""The extensibility seam: a custom source registers and resolves by id."""

import pytest

from weaveforge.features.experiments.domain.metric_point import MetricSeries
from weaveforge.sync import SyncRegistry


class FakeSource:
    id = "fake"

    def available(self) -> bool:
        return True

    def read(self, ref):
        s = MetricSeries("loss")
        s.add(0, 1.0)
        s.add(1, 0.5)
        return [s]


def test_register_and_get():
    reg = SyncRegistry()
    reg.register(FakeSource())
    assert reg.has("fake")
    assert reg.ids() == ["fake"]
    src = reg.get("fake")
    series = list(src.read(None))
    assert series[0].last_value == 0.5


def test_duplicate_register_rejected():
    reg = SyncRegistry()
    reg.register(FakeSource())
    with pytest.raises(ValueError):
        reg.register(FakeSource())
    reg.register(FakeSource(), replace=True)  # explicit replace is fine


def test_unknown_source_raises():
    reg = SyncRegistry()
    with pytest.raises(KeyError):
        reg.get("nope")

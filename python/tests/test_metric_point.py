"""wall_time normalization — the guard against invalid timestamptz inserts."""

from datetime import datetime, timezone

from thesis_tracker.features.experiments.domain.metric_point import (
    MetricPoint,
    MetricSeries,
    normalize_wall_time,
)


def test_epoch_seconds_become_iso():
    iso = normalize_wall_time(1_700_000_000.0)
    assert iso.startswith("2023-11-14T") and iso.endswith("+00:00")


def test_datetime_gets_utc_and_iso():
    naive = datetime(2026, 6, 24, 12, 0, 0)
    assert normalize_wall_time(naive) == "2026-06-24T12:00:00+00:00"
    aware = datetime(2026, 6, 24, 12, 0, 0, tzinfo=timezone.utc)
    assert normalize_wall_time(aware) == "2026-06-24T12:00:00+00:00"


def test_none_and_bool_and_str():
    assert normalize_wall_time(None) is None
    assert normalize_wall_time(True) is None
    assert normalize_wall_time("2026-06-24T12:00:00Z") == "2026-06-24T12:00:00Z"


def test_metric_point_normalizes_on_construction():
    p = MetricPoint("e1", "loss", 0, 1.0, wall_time=1_700_000_000.0)
    assert isinstance(p.wall_time, str) and "T" in p.wall_time


def test_series_to_points_carry_iso_wall_time():
    s = MetricSeries("loss")
    s.add(0, 1.0, 1_700_000_000.0)  # epoch, as a wandb-style source would emit
    pt = next(s.to_points("e1"))
    assert pt.wall_time.startswith("2023-11-14T")

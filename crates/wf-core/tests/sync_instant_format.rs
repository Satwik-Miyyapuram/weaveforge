//! Tests for `sync::instant::format_instant`, the inverse of `parse_instant`.
//! Output matches JS `Date.prototype.toISOString`.

use wf_core::sync::instant::{format_instant, parse_instant};

#[test]
fn formats_epoch_zero() {
    assert_eq!(format_instant(0), "1970-01-01T00:00:00.000Z");
}

#[test]
fn formats_a_known_instant_with_millis() {
    assert_eq!(
        format_instant(1_700_000_000_123),
        "2023-11-14T22:13:20.123Z"
    );
}

#[test]
fn formats_one_millisecond_before_epoch() {
    assert_eq!(format_instant(-1), "1969-12-31T23:59:59.999Z");
}

#[test]
fn formats_leap_day() {
    assert_eq!(format_instant(951_782_400_000), "2000-02-29T00:00:00.000Z");
}

#[test]
fn round_trips_through_parse_instant() {
    for ms in [0, 1_700_000_000_123, 951_782_400_000, 4_102_444_799_999] {
        assert_eq!(parse_instant(&format_instant(ms)), Some(ms));
    }
}

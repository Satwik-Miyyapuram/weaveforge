//! Unit newtypes used inside the crates (plan §4.2, §4.7). IPC carries bare `u64` with the unit
//! last in the name instead, so these do not derive serde or specta.

use std::time::Duration;

/// A length in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct ByteLen(pub u64);

/// A span of time in whole milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct DurationMs(pub u64);

impl From<DurationMs> for Duration {
    fn from(ms: DurationMs) -> Self {
        Self::from_millis(ms.0)
    }
}

impl From<Duration> for DurationMs {
    /// Whole milliseconds, rounded down; a span past `u64::MAX` ms saturates.
    fn from(span: Duration) -> Self {
        Self(u64::try_from(span.as_millis()).unwrap_or(u64::MAX))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_ms_becomes_the_same_duration() {
        assert_eq!(Duration::from(DurationMs(0)), Duration::ZERO);
        assert_eq!(
            Duration::from(DurationMs(1_500)),
            Duration::from_millis(1_500)
        );
        assert_eq!(
            Duration::from(DurationMs(u64::MAX)),
            Duration::from_millis(u64::MAX)
        );
    }

    #[test]
    fn duration_becomes_whole_milliseconds_rounded_down() {
        assert_eq!(
            DurationMs::from(Duration::from_millis(1_500)),
            DurationMs(1_500)
        );
        assert_eq!(
            DurationMs::from(Duration::from_micros(1_999)),
            DurationMs(1)
        );
        assert_eq!(
            DurationMs::from(Duration::from_nanos(999_999)),
            DurationMs(0)
        );
    }

    #[test]
    fn a_duration_past_u64_milliseconds_saturates() {
        assert_eq!(DurationMs::from(Duration::MAX), DurationMs(u64::MAX));
        let edge = Duration::from_millis(u64::MAX);
        assert_eq!(DurationMs::from(edge), DurationMs(u64::MAX));
        assert_eq!(
            DurationMs::from(edge + Duration::from_millis(1)),
            DurationMs(u64::MAX)
        );
    }

    #[test]
    fn round_trip_keeps_whole_milliseconds() {
        for ms in [0, 1, 999, 1_000, 86_400_000, u64::MAX] {
            assert_eq!(
                DurationMs::from(Duration::from(DurationMs(ms))),
                DurationMs(ms)
            );
        }
    }

    #[test]
    fn units_order_and_default_to_zero() {
        assert!(ByteLen(1) < ByteLen(2));
        assert!(DurationMs(10) > DurationMs(9));
        assert_eq!(ByteLen::default(), ByteLen(0));
        assert_eq!(DurationMs::default(), DurationMs(0));
    }
}

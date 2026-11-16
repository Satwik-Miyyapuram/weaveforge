//! When the next auto-apply runs (`scheduleAutoApply` in
//! `apps/web/.../workspace/application/workspace-folder.ts`).
//!
//! Each new outside edit restarts a debounce, but the first wait is never put off
//! longer than the max wait, so a folder that never goes quiet is still read. The
//! caller reads the clock and keeps the timer; this decides how long to wait and
//! the first-ask time to keep for the next call.

use serde::{Deserialize, Serialize};

/// The clock and the waiting state: when this ask comes, when the wait first began
/// (`None` when no auto-apply waits), and the two windows in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoApplyInput {
    /// Current time in milliseconds.
    pub now: f64,
    /// When the waiting auto-apply was first asked for, if one waits.
    #[serde(default)]
    pub first_at: Option<f64>,
    /// Quiet time after the last edit.
    pub debounce_ms: f64,
    /// Longest the first ask may be put off.
    pub max_wait_ms: f64,
}

/// How long to wait before the run, and the first-ask time to keep.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoApplyTiming {
    /// Milliseconds until the run.
    pub delay: f64,
    /// First-ask time to keep until the run starts.
    pub first_at: f64,
}

/// The wait for the next auto-apply run.
///
/// The delay is the debounce, capped so the first ask waits no longer than the max
/// wait, and never negative.
#[must_use]
pub fn auto_apply_timing(input: &AutoApplyInput) -> AutoApplyTiming {
    let first_at = input.first_at.unwrap_or(input.now);
    let remaining = (first_at + input.max_wait_ms - input.now).max(0.0);
    AutoApplyTiming {
        delay: input.debounce_ms.min(remaining),
        first_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEBOUNCE: f64 = 800.0;
    const MAX_WAIT: f64 = 2000.0;

    fn input(now: f64, first_at: Option<f64>) -> AutoApplyInput {
        AutoApplyInput {
            now,
            first_at,
            debounce_ms: DEBOUNCE,
            max_wait_ms: MAX_WAIT,
        }
    }

    #[test]
    fn a_first_ask_waits_the_debounce_and_starts_the_wait_now() {
        let timing = auto_apply_timing(&input(10_000.0, None));
        assert_eq!(timing.delay, DEBOUNCE);
        assert_eq!(timing.first_at, 10_000.0);
    }

    #[test]
    fn a_later_ask_keeps_the_first_time_and_waits_the_debounce_while_under_the_max() {
        let timing = auto_apply_timing(&input(10_500.0, Some(10_000.0)));
        assert_eq!(timing.delay, DEBOUNCE);
        assert_eq!(timing.first_at, 10_000.0);
    }

    #[test]
    fn a_stream_of_edits_is_read_once_the_max_wait_is_reached() {
        let timing = auto_apply_timing(&input(11_600.0, Some(10_000.0)));
        assert_eq!(timing.delay, 400.0);
        assert_eq!(timing.first_at, 10_000.0);
    }

    #[test]
    fn past_the_max_wait_the_delay_is_zero_never_negative() {
        let timing = auto_apply_timing(&input(20_000.0, Some(10_000.0)));
        assert_eq!(timing.delay, 0.0);
        assert_eq!(timing.first_at, 10_000.0);
    }
}

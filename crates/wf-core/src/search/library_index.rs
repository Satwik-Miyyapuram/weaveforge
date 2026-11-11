//! Library index rules for the background PDF indexer. Port of the retry-window filter in
//! apps/web/src/features/search/application/parts-1.ts and the courtesy-pause
//! decision in apps/web/src/features/search/application/parts-1.ts. Pure: the caller
//! reads storage, reads the clock and waits.

/// How long a paper that could not be read is held back before it is tried again: seven days, in
/// milliseconds.
pub const RETRY_AFTER_MS: f64 = 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;

/// The ids whose last failure is still inside the retry window at `now`, so they are skipped.
///
/// `failures` holds `(paper id, failed-at epoch milliseconds)`. An id is returned when
/// `now - at < RETRY_AFTER_MS`. A `NaN` time fails that comparison, so its id is not returned, and
/// the order of the result follows the order of `failures`.
#[must_use]
pub fn recent_failure_ids(failures: &[(String, f64)], now: f64) -> Vec<String> {
    failures
        .iter()
        .filter(|(_, at)| now - at < RETRY_AFTER_MS)
        .map(|(id, _)| id.clone())
        .collect()
}

/// Whether the loop waits before asking the next paper's host.
///
/// The courtesy delay applies only to a paper that was fetched from its host, not served from the
/// browser cache, and only once at least one paper has already been indexed or has failed.
#[must_use]
pub fn courtesy_pause_due(from_cache: bool, indexed: usize, failed: usize) -> bool {
    !from_cache && indexed + failed > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: f64 = 24.0 * 60.0 * 60.0 * 1000.0;

    #[test]
    fn retry_window_is_seven_days() {
        assert_eq!(RETRY_AFTER_MS, 7.0 * DAY);
    }

    #[test]
    fn a_failure_inside_the_window_is_skipped_and_an_older_one_is_retried() {
        let now = 100.0 * DAY;
        let failures = vec![
            ("recent".to_owned(), now - DAY),
            ("old".to_owned(), now - 8.0 * DAY),
        ];
        assert_eq!(
            recent_failure_ids(&failures, now),
            vec!["recent".to_owned()]
        );
    }

    #[test]
    fn a_failure_exactly_at_the_window_edge_is_retried() {
        let now = 50.0 * DAY;
        let failures = vec![("edge".to_owned(), now - RETRY_AFTER_MS)];
        assert!(recent_failure_ids(&failures, now).is_empty());
    }

    #[test]
    fn a_failure_stamped_in_the_future_is_still_skipped() {
        let now = 10.0 * DAY;
        let failures = vec![("future".to_owned(), now + DAY)];
        assert_eq!(
            recent_failure_ids(&failures, now),
            vec!["future".to_owned()]
        );
    }

    #[test]
    fn a_non_finite_failure_time_is_not_skipped() {
        let now = 10.0 * DAY;
        let failures = vec![("nan".to_owned(), f64::NAN)];
        assert!(recent_failure_ids(&failures, now).is_empty());
    }

    #[test]
    fn no_failures_gives_no_ids() {
        assert!(recent_failure_ids(&[], 10.0 * DAY).is_empty());
    }

    #[test]
    fn courtesy_pause_waits_only_after_a_fetch_once_something_has_happened() {
        assert!(courtesy_pause_due(false, 1, 0));
        assert!(courtesy_pause_due(false, 0, 1));
        assert!(!courtesy_pause_due(false, 0, 0));
        assert!(!courtesy_pause_due(true, 3, 2));
    }
}

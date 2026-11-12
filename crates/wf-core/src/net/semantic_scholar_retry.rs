//! Semantic Scholar retry policy (TS `apps/web/src/lib/semantic-scholar-fetch.ts`).
//! Pure: the fetch, the wait and the thrown `TypeError` stay in TS.

/// Retries after the first attempt.
pub const RETRIES: u32 = 3;

/// Whether an attempt should be retried. `status` is the HTTP status of a response, or `None`
/// for a thrown network error (which the TS only reports on the relay path, where it is ambiguous).
/// A 429 and a network error are retried, up to [`RETRIES`] times. `attempt` counts retries done.
#[must_use]
pub fn should_retry(status: Option<u16>, attempt: u32) -> bool {
    let throttled = status.is_none_or(|code| code == 429);
    throttled && attempt < RETRIES
}

/// The wait before retry number `attempt + 1`: one second, then two, then three.
#[must_use]
pub fn retry_wait_ms(attempt: u32) -> u32 {
    1000 * (attempt + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_429_is_retried_until_the_budget_is_spent() {
        // it: a 429 is retried until it clears
        assert!(should_retry(Some(429), 0));
        assert!(should_retry(Some(429), 2));
        assert!(!should_retry(Some(429), 3));
    }

    #[test]
    fn a_network_error_is_retried_like_a_429() {
        // it: a thrown TypeError on the relay path is retried like a 429
        assert!(should_retry(None, 0));
        assert!(!should_retry(None, RETRIES));
    }

    #[test]
    fn other_statuses_are_not_retried() {
        assert!(!should_retry(Some(200), 0));
        assert!(!should_retry(Some(500), 0));
    }

    #[test]
    fn the_waits_grow_by_a_second_each_time() {
        assert_eq!(retry_wait_ms(0), 1000);
        assert_eq!(retry_wait_ms(1), 2000);
        assert_eq!(retry_wait_ms(2), 3000);
    }
}

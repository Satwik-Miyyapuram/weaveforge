#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::time::{Duration, Instant};

use wf_relay_server::limiter::{Limit, PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};

fn limiter(capacity: f64, refill_per_second: f64) -> RateLimiter {
    RateLimiter::new(Limit {
        capacity,
        refill_per_second,
    })
}

#[test]
fn published_limits_match_the_ts_policy() {
    assert_eq!(PASTE_FETCH_LIMIT.capacity, 20.0);
    assert_eq!(PASTE_FETCH_LIMIT.refill_per_second, 0.5);
    assert_eq!(PAGE_FETCH_LIMIT.capacity, 10.0);
    assert_eq!(PAGE_FETCH_LIMIT.refill_per_second, 0.2);
}

#[test]
fn burst_of_capacity_is_allowed_then_denied() {
    let limiter = limiter(3.0, 1.0);
    let now = Instant::now();
    assert!(limiter.take("u", now).is_ok());
    assert!(limiter.take("u", now).is_ok());
    assert!(limiter.take("u", now).is_ok());
    assert!(limiter.take("u", now).is_err());
}

#[test]
fn retry_after_is_ceiling_of_missing_over_refill() {
    let now = Instant::now();

    let fast = limiter(3.0, 1.0);
    for _ in 0..3 {
        assert!(fast.take("u", now).is_ok());
    }
    assert_eq!(fast.take("u", now), Err(1));

    let paste = limiter(20.0, 0.5);
    for _ in 0..20 {
        assert!(paste.take("u", now).is_ok());
    }
    assert_eq!(paste.take("u", now), Err(2));

    let page = limiter(10.0, 0.2);
    for _ in 0..10 {
        assert!(page.take("u", now).is_ok());
    }
    assert_eq!(page.take("u", now), Err(5));
}

#[test]
fn retry_after_is_at_least_one_second() {
    let limiter = limiter(1.0, 1.0);
    let now = Instant::now();
    assert!(limiter.take("u", now).is_ok());
    // Half a token is missing, so the raw wait is 0.5s; the floor is 1.
    assert_eq!(limiter.take("u", now + Duration::from_millis(500)), Err(1));
}

#[test]
fn refills_by_elapsed_time() {
    let limiter = limiter(2.0, 1.0);
    let start = Instant::now();
    assert!(limiter.take("u", start).is_ok());
    assert!(limiter.take("u", start).is_ok());
    assert!(limiter.take("u", start).is_err());

    // The refused take left 0 tokens at `start`; one second restores one.
    assert!(limiter.take("u", start + Duration::from_secs(1)).is_ok());
    assert!(limiter.take("u", start + Duration::from_secs(1)).is_err());
}

#[test]
fn partial_refill_is_not_enough() {
    let limiter = limiter(1.0, 1.0);
    let start = Instant::now();
    assert!(limiter.take("u", start).is_ok());
    assert_eq!(
        limiter.take("u", start + Duration::from_millis(500)),
        Err(1)
    );
    assert!(
        limiter
            .take("u", start + Duration::from_millis(1000))
            .is_ok()
    );
}

#[test]
fn refill_is_capped_at_capacity() {
    let limiter = limiter(2.0, 1.0);
    let start = Instant::now();
    let later = start + Duration::from_secs(3600);
    assert!(limiter.take("u", later).is_ok());
    assert!(limiter.take("u", later).is_ok());
    assert!(limiter.take("u", later).is_err());
}

#[test]
fn keys_have_separate_buckets() {
    let limiter = limiter(1.0, 0.1);
    let now = Instant::now();
    assert!(limiter.take("a", now).is_ok());
    assert!(limiter.take("a", now).is_err());
    assert!(limiter.take("b", now).is_ok());
}

#[test]
fn bucket_is_created_full_for_a_new_key() {
    let limiter = limiter(5.0, 0.1);
    let start = Instant::now();
    for _ in 0..5 {
        assert!(limiter.take("new", start).is_ok());
    }
    assert!(limiter.take("new", start).is_err());
}

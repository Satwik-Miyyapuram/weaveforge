//! Per-key token buckets: a port of `apps/web/src/backend/net/rate-limit.ts`.
//!
//! A bucket per key, created full, refilled by elapsed time and capped at
//! capacity. Each process holds its own buckets, so the limit is per instance.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::Instant;

/// Bucket budget: `capacity` tokens held, refilled at `refill_per_second`.
#[derive(Debug, Clone, Copy)]
pub struct Limit {
    /// Tokens the bucket holds. A burst larger than this is refused.
    pub capacity: f64,
    /// Tokens added per second, which is the sustained rate.
    pub refill_per_second: f64,
}

/// Twenty in a burst and one refilled every two seconds, for pasted-resource fetches.
pub const PASTE_FETCH_LIMIT: Limit = Limit {
    capacity: 20.0,
    refill_per_second: 0.5,
};

/// Ten in a burst and one every five seconds, for pages from hosts on no list.
pub const PAGE_FETCH_LIMIT: Limit = Limit {
    capacity: 10.0,
    refill_per_second: 0.2,
};

/// Above this many keys, buckets that have refilled to capacity are dropped.
/// A full bucket behaves exactly like a missing one, so this bounds memory
/// without changing any decision.
const MAX_BUCKETS: usize = 10_000;

/// Upper bound on a retry-after, so a near-zero refill rate cannot overflow.
const MAX_RETRY_SECONDS: f64 = 86_400.0;

#[derive(Debug, Clone, Copy)]
struct Bucket {
    tokens: f64,
    updated_at: Instant,
}

/// A token-bucket limiter keyed by string (for example a user id).
pub struct RateLimiter {
    limit: Limit,
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl RateLimiter {
    /// A limiter whose buckets start full.
    #[must_use]
    pub fn new(limit: Limit) -> Self {
        Self {
            limit,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Spend one token for `key`, or refuse.
    ///
    /// `Err` carries whole seconds until a token is available, at least 1.
    pub fn take(&self, key: &str, now: Instant) -> Result<(), u64> {
        let mut buckets = self.buckets.lock().unwrap_or_else(PoisonError::into_inner);
        let current = buckets.get(key).copied().unwrap_or(Bucket {
            tokens: self.limit.capacity,
            updated_at: now,
        });
        let tokens = self.refilled(current, now);
        let (outcome, left) = if tokens < 1.0 {
            let missing = 1.0 - tokens;
            (
                Err(retry_seconds(missing / self.limit.refill_per_second)),
                tokens,
            )
        } else {
            (Ok(()), tokens - 1.0)
        };
        let _ = buckets.insert(
            key.to_owned(),
            Bucket {
                tokens: left,
                updated_at: now,
            },
        );
        if buckets.len() > MAX_BUCKETS {
            buckets.retain(|_, bucket| !self.is_full(*bucket, now));
        }
        outcome
    }

    /// The bucket's token count at `now`, after refill and capped at capacity.
    fn refilled(&self, bucket: Bucket, now: Instant) -> f64 {
        let elapsed = now
            .saturating_duration_since(bucket.updated_at)
            .as_secs_f64();
        (bucket.tokens + elapsed * self.limit.refill_per_second).min(self.limit.capacity)
    }

    fn is_full(&self, bucket: Bucket, now: Instant) -> bool {
        self.refilled(bucket, now) >= self.limit.capacity
    }
}

/// `max(1, ceil(secs))` as whole seconds, capped at one day.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn retry_seconds(secs: f64) -> u64 {
    // Non-finite input (refill of zero) takes the cap; otherwise the clamp runs
    // before the cast, so the value is in 1.0..=86_400.0 and fits u64 exactly.
    let bounded = if secs.is_finite() {
        secs.ceil().clamp(1.0, MAX_RETRY_SECONDS)
    } else {
        MAX_RETRY_SECONDS
    };
    bounded as u64
}

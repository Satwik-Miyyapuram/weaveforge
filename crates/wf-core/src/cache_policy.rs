//! How old a cached screen payload may be, for two different questions (TS `cache-policy.ts`).
//!
//! * **Skip the network?** Within `revalidate_after_ms` the cached payload is shown without a
//!   refetch. Past it, the payload is still shown and refreshed behind the reader.
//! * **Show it at all?** Past `show_max_age_ms` the payload counts as absent.
//!
//! Both ages are measured from when the payload was fetched, not from when it was read back.
//! The TS constants stay in `apps/web/src/lib/cache/cache-policy.ts`, because `cache-repo.ts`
//! reads them at module evaluation, before the wasm core is initialised.

use serde::Serialize;

/// Older than this: show it, and refetch in the background.
pub const SCREEN_REVALIDATE_AFTER_MS: u64 = 120_000;

/// Older than this: do not show it. A week.
pub const SCREEN_SHOW_MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// Both screen-cache ages, in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ScreenCachePolicy {
    /// Age after which a cached screen is revalidated.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub revalidate_after_ms: u64,
    /// Oldest cached screen that may still be shown.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub show_max_age_ms: u64,
}

/// The screen-cache policy (see the module docs for the two questions).
#[must_use]
pub const fn screen_cache_policy() -> ScreenCachePolicy {
    ScreenCachePolicy {
        revalidate_after_ms: SCREEN_REVALIDATE_AFTER_MS,
        show_max_age_ms: SCREEN_SHOW_MAX_AGE_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::{SCREEN_REVALIDATE_AFTER_MS, SCREEN_SHOW_MAX_AGE_MS, screen_cache_policy};

    #[test]
    fn values_match_the_ts_constants() {
        let policy = screen_cache_policy();
        assert_eq!(policy.revalidate_after_ms, 120_000);
        assert_eq!(policy.show_max_age_ms, 604_800_000);
        assert_eq!(policy.revalidate_after_ms, SCREEN_REVALIDATE_AFTER_MS);
        assert_eq!(policy.show_max_age_ms, SCREEN_SHOW_MAX_AGE_MS);
    }
}

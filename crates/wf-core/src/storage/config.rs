//! Blob storage config from env, and the blob provider choice at runtime.
//! Ported from `apps/web/src/storage/config.ts` and `storage/wire-storage.ts`.
//! Pure: the caller passes the env map (missing and empty values both mean unset).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Env bag: variable name to value. Absent and empty values both count as unset.
pub type EnvMap = BTreeMap<String, String>;

/// Blob adapter ids. `Supabase` is the legacy fallback when nothing is set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum BlobProviderId {
    /// Legacy Supabase storage.
    Supabase,
    /// Hot/cold tiered storage (R2 hot, MinIO cold).
    Tiered,
}

/// Blob and tiering settings read from env.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    /// Primary blob adapter.
    pub provider: BlobProviderId,
    /// Hot-tier quota in GB.
    pub hot_quota_gb: f64,
    /// Hot-tier fill ratio that starts eviction.
    pub hot_high_watermark: f64,
    /// Hot-tier fill ratio eviction stops at.
    pub hot_low_watermark: f64,
    /// Objects moved per eviction batch.
    pub tier_batch_size: f64,
    /// Eviction score weight on access count.
    pub tier_alpha: f64,
    /// Eviction score weight on age.
    pub tier_beta: f64,
    /// Eviction score weight on priority.
    pub tier_gamma: f64,
    /// Promote a cold object to hot when it is read.
    pub promote_on_access: bool,
    /// R2 account id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub r2_account_id: Option<String>,
    /// R2 access key id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub r2_access_key_id: Option<String>,
    /// R2 secret access key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub r2_secret_access_key: Option<String>,
    /// R2 bucket name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub r2_bucket: Option<String>,
    /// MinIO / OCI cold-tier endpoint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cold_endpoint: Option<String>,
    /// Cold-tier access key id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cold_access_key_id: Option<String>,
    /// Cold-tier secret access key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cold_secret_access_key: Option<String>,
    /// Cold-tier bucket name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub cold_bucket: Option<String>,
}

/// Where the blob provider choice is being made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BlobRuntime {
    /// True in the browser, where the inlined public setting decides.
    pub in_browser: bool,
    /// The inlined `NEXT_PUBLIC_BLOB_PROVIDER` value, if any.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub public_provider: Option<String>,
}

/// Read blob and tiering settings from env.
///
/// `NEXT_PUBLIC_BLOB_PROVIDER` wins over `BLOB_PROVIDER` when it is set, even if
/// its value is not a known provider (then the provider is `Supabase`).
#[must_use]
pub fn read_storage_config(env: &EnvMap) -> StorageConfig {
    let provider_raw =
        non_empty(env, "NEXT_PUBLIC_BLOB_PROVIDER").or_else(|| non_empty(env, "BLOB_PROVIDER"));
    StorageConfig {
        provider: parse_blob_provider(provider_raw),
        hot_quota_gb: float_env(env, "BLOB_HOT_QUOTA_GB", 10.0),
        hot_high_watermark: float_env(env, "BLOB_HOT_HIGH_WATERMARK", 0.85),
        hot_low_watermark: float_env(env, "BLOB_HOT_LOW_WATERMARK", 0.75),
        tier_batch_size: int_env(env, "BLOB_TIER_BATCH_SIZE", 100.0),
        tier_alpha: float_env(env, "BLOB_TIER_ALPHA", 1.0),
        tier_beta: float_env(env, "BLOB_TIER_BETA", 30.0),
        tier_gamma: float_env(env, "BLOB_TIER_GAMMA", 0.5),
        promote_on_access: bool_env(env, "BLOB_PROMOTE_ON_ACCESS", true),
        r2_account_id: owned(env, "R2_ACCOUNT_ID"),
        r2_access_key_id: owned(env, "R2_ACCESS_KEY_ID"),
        r2_secret_access_key: owned(env, "R2_SECRET_ACCESS_KEY"),
        r2_bucket: owned(env, "R2_BUCKET"),
        cold_endpoint: owned(env, "BLOB_COLD_ENDPOINT"),
        cold_access_key_id: owned(env, "BLOB_COLD_ACCESS_KEY_ID"),
        cold_secret_access_key: owned(env, "BLOB_COLD_SECRET_ACCESS_KEY"),
        cold_bucket: owned(env, "BLOB_COLD_BUCKET"),
    }
}

/// The provider named by `raw`: `tiered` is tiered, anything else (or unset) is Supabase.
#[must_use]
pub fn parse_blob_provider(raw: Option<&str>) -> BlobProviderId {
    match raw {
        Some("tiered") => BlobProviderId::Tiered,
        _ => BlobProviderId::Supabase,
    }
}

/// The provider to use: the configured one, except the browser follows the
/// inlined public setting when it says `tiered`.
#[must_use]
pub fn blob_provider_for_runtime(
    configured: BlobProviderId,
    runtime: &BlobRuntime,
) -> BlobProviderId {
    if runtime.in_browser && runtime.public_provider.as_deref() == Some("tiered") {
        BlobProviderId::Tiered
    } else {
        configured
    }
}

/// The value of `key`, or `None` when it is unset or empty.
fn non_empty<'a>(env: &'a EnvMap, key: &str) -> Option<&'a str> {
    env.get(key).map(String::as_str).filter(|v| !v.is_empty())
}

fn owned(env: &EnvMap, key: &str) -> Option<String> {
    non_empty(env, key).map(str::to_owned)
}

/// `Number(value)` in JS, with the fallback for empty, non-finite or NaN results.
/// Blank text reads as 0, as `Number("  ")` does.
fn float_env(env: &EnvMap, key: &str, fallback: f64) -> f64 {
    match non_empty(env, key) {
        None => fallback,
        Some(raw) => js_number(raw).filter(|n| n.is_finite()).unwrap_or(fallback),
    }
}

/// `Number.parseInt(value, 10)`, with the fallback for NaN or non-finite results.
fn int_env(env: &EnvMap, key: &str, fallback: f64) -> f64 {
    match non_empty(env, key) {
        None => fallback,
        Some(raw) => js_parse_int(raw)
            .filter(|n| n.is_finite())
            .unwrap_or(fallback),
    }
}

/// `value === "1" || value.toLowerCase() === "true"`, with the fallback when unset.
fn bool_env(env: &EnvMap, key: &str, fallback: bool) -> bool {
    match non_empty(env, key) {
        None => fallback,
        Some(raw) => raw == "1" || raw.to_lowercase() == "true",
    }
}

/// JS `Number(text)`: trims, reads `0x`/`0o`/`0b` prefixes, otherwise a decimal.
fn js_number(text: &str) -> Option<f64> {
    let t = text.trim();
    if t.is_empty() {
        return Some(0.0);
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = t.strip_prefix(prefix) {
            return u32::from_str_radix(digits, radix).ok().map(f64::from);
        }
    }
    t.parse::<f64>().ok()
}

/// JS `Number.parseInt(text, 10)`: leading whitespace, an optional sign, then digits.
fn js_parse_int(text: &str) -> Option<f64> {
    let t = text.trim_start();
    let (sign, rest) = match t.as_bytes().first() {
        Some(b'-') => (-1.0, &t[1..]),
        Some(b'+') => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    let digits = rest
        .split(|c: char| !c.is_ascii_digit())
        .next()
        .unwrap_or("");
    if digits.is_empty() {
        return None;
    }
    digits.parse::<f64>().ok().map(|n| sign * n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> EnvMap {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn defaults_to_supabase_with_tier_knobs() {
        let c = read_storage_config(&EnvMap::new());
        assert_eq!(c.provider, BlobProviderId::Supabase);
        assert!((c.hot_quota_gb - 10.0).abs() < f64::EPSILON);
        assert!((c.tier_batch_size - 100.0).abs() < f64::EPSILON);
        assert!(c.promote_on_access);
        assert!(c.r2_bucket.is_none());
    }

    #[test]
    fn public_provider_wins_and_unknown_falls_back() {
        let c = read_storage_config(&env(&[
            ("NEXT_PUBLIC_BLOB_PROVIDER", "tiered"),
            ("BLOB_PROVIDER", "supabase"),
        ]));
        assert_eq!(c.provider, BlobProviderId::Tiered);
        let c = read_storage_config(&env(&[
            ("NEXT_PUBLIC_BLOB_PROVIDER", "nope"),
            ("BLOB_PROVIDER", "tiered"),
        ]));
        assert_eq!(c.provider, BlobProviderId::Supabase);
    }

    #[test]
    fn parses_numbers_bools_and_empty_as_unset() {
        let c = read_storage_config(&env(&[
            ("BLOB_HOT_QUOTA_GB", "2.5"),
            ("BLOB_TIER_BATCH_SIZE", "7abc"),
            ("BLOB_TIER_ALPHA", "junk"),
            ("BLOB_PROMOTE_ON_ACCESS", "0"),
            ("R2_BUCKET", ""),
        ]));
        assert!((c.hot_quota_gb - 2.5).abs() < f64::EPSILON);
        assert!((c.tier_batch_size - 7.0).abs() < f64::EPSILON);
        assert!((c.tier_alpha - 1.0).abs() < f64::EPSILON);
        assert!(!c.promote_on_access);
        assert!(c.r2_bucket.is_none());
    }

    #[test]
    fn runtime_follows_public_setting_only_in_browser() {
        let tiered_public = BlobRuntime {
            in_browser: true,
            public_provider: Some("tiered".to_owned()),
        };
        assert_eq!(
            blob_provider_for_runtime(BlobProviderId::Supabase, &tiered_public),
            BlobProviderId::Tiered
        );
        let server = BlobRuntime {
            in_browser: false,
            public_provider: Some("tiered".to_owned()),
        };
        assert_eq!(
            blob_provider_for_runtime(BlobProviderId::Supabase, &server),
            BlobProviderId::Supabase
        );
    }
}

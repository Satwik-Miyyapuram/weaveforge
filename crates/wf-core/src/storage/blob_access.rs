//! Blob access rules, ported from `apps/web/src/storage/server/blob-access.ts`,
//! `apps/web/src/storage/signed-url-limits.ts` and `blob-view-token.ts`. Pure
//! checks only: no I/O and no clock; callers pass `now` in.

/// Every bucket a user's blobs live in.
pub const BLOB_STORAGE_BUCKETS: [&str; 5] = [
    "paper-images",
    "experiment-artifacts",
    "vault-assets",
    "report-images",
    "log-images",
];
/// Largest blob accepted, in bytes.
pub const MAX_BLOB_BYTES: u64 = 25 * 1024 * 1024;
/// Most paths one signed-url request may ask for.
pub const MAX_SIGNED_URL_PATHS: usize = 200;
/// Shortest signed-url lifetime, in seconds.
pub const MIN_TTL_SECONDS: u64 = 60;
/// Longest signed-url lifetime, in seconds.
pub const MAX_TTL_SECONDS: u64 = 3600;
/// View-token expiries round up to this step, in seconds.
pub const BLOB_VIEW_STEP_S: u64 = 300;

/// A refusal the caller can fix: HTTP status and exact message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlobRefusal {
    /// HTTP status to reply with.
    pub status: u16,
    /// Message to reply with.
    pub message: &'static str,
}

/// Refuse buckets outside `BLOB_STORAGE_BUCKETS`.
pub fn check_allowed_bucket(bucket: &str) -> Result<(), BlobRefusal> {
    if BLOB_STORAGE_BUCKETS.contains(&bucket) {
        Ok(())
    } else {
        Err(BlobRefusal {
            status: 400,
            message: "Unsupported blob bucket.",
        })
    }
}

/// Refuse malformed paths (400) and paths outside the caller's `{uid}/` folder (403).
pub fn check_path_owned(path: &str, uid: &str) -> Result<(), BlobRefusal> {
    if path.is_empty() || path.contains("..") || path.starts_with('/') || path.contains('\\') {
        return Err(BlobRefusal {
            status: 400,
            message: "Invalid blob path.",
        });
    }
    // Needs a non-empty name after `{uid}/`, not just the prefix.
    let owned = path
        .strip_prefix(uid)
        .and_then(|rest| rest.strip_prefix('/'))
        .is_some_and(|name| !name.is_empty());
    if owned {
        Ok(())
    } else {
        Err(BlobRefusal {
            status: 403,
            message: "Forbidden blob path.",
        })
    }
}

/// The shared resource type a bucket's paths name, or None for an unknown bucket.
#[must_use]
pub fn shared_resource_for(bucket: &str) -> Option<&'static str> {
    match bucket {
        "paper-images" => Some("paper"),
        "experiment-artifacts" => Some("experiment"),
        "vault-assets" => Some("vault_page"),
        "report-images" => Some("report_section"),
        "log-images" => Some("log_entry"),
        _ => None,
    }
}

/// The second path segment, if it is a version 1-5 UUID.
#[must_use]
pub fn resource_id_from_path(path: &str) -> Option<&str> {
    let seg = path.split('/').nth(1)?;
    is_uuid(seg).then_some(seg)
}

/// Requested lifetime clamped into 60..=3600 seconds; missing or non-finite means 3600.
#[must_use]
pub fn clamp_ttl_seconds(requested: Option<f64>) -> u64 {
    let Some(x) = requested.filter(|x| x.is_finite()) else {
        return MAX_TTL_SECONDS;
    };
    // Clamped to whole seconds in 60..=3600, so the parse always succeeds.
    format!("{:.0}", x.floor().clamp(60.0, 3600.0))
        .parse::<u64>()
        .unwrap_or(MAX_TTL_SECONDS)
}

/// Expiry for a view token: `now + ttl`, rounded up to the next `BLOB_VIEW_STEP_S`.
#[must_use]
pub fn view_token_exp(now_s: u64, ttl_s: u64) -> u64 {
    now_s
        .saturating_add(ttl_s)
        .div_ceil(BLOB_VIEW_STEP_S)
        .saturating_mul(BLOB_VIEW_STEP_S)
}

/// Private cache while the token lives; `no-store` once it has expired.
#[must_use]
pub fn blob_cache_control(exp: u64, now_s: u64) -> String {
    if exp > now_s {
        format!("private, max-age={}, immutable", exp - now_s)
    } else {
        "private, no-store".to_owned()
    }
}

/// A 1-128 character name of ASCII letters, digits, `.`, `_` or `-`, not `.` or `..`.
#[must_use]
pub fn is_safe_segment(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        && value != "."
        && value != ".."
}

/// Decoded byte count of a base64 string, ignoring trailing `=` padding.
#[must_use]
pub fn base64_byte_length(data: &str) -> u64 {
    let len = u64::try_from(data.trim_end_matches('=').len()).unwrap_or(u64::MAX);
    len.saturating_mul(3) / 4
}

/// Matches `8-4-[1-5]xxx-[89ab]xxx-12` hex, either case.
fn is_uuid(value: &str) -> bool {
    let parts: Vec<&str> = value.split('-').collect();
    let [a, b, c, d, e] = parts.as_slice() else {
        return false;
    };
    let version_ok = matches!(c.bytes().next(), Some(b'1'..=b'5'));
    let variant_ok = matches!(
        d.bytes().next(),
        Some(b'8' | b'9' | b'a' | b'b' | b'A' | b'B')
    );
    is_hex(a, 8)
        && is_hex(b, 4)
        && is_hex(c, 4)
        && is_hex(d, 4)
        && is_hex(e, 12)
        && version_ok
        && variant_ok
}

fn is_hex(value: &str, len: usize) -> bool {
    value.len() == len && value.bytes().all(|b| b.is_ascii_hexdigit())
}

//! Signed view tokens for tiered blob reads. Port of
//! `apps/web/src/storage/server/blob-view-token.ts`.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use wf_core::storage::blob_access::view_token_exp;

/// Reply text when `BLOB_VIEW_SECRET` is not set.
pub const MISSING_SECRET: &str =
    "Set BLOB_VIEW_SECRET for tiered blob viewing (`openssl rand -base64 48`).";

/// What a view token grants: one blob, for one user, until `exp` (Unix seconds).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BlobViewPayload {
    /// Owner of the blob; the path must sit under this user.
    pub uid: String,
    /// Storage bucket the blob lives in.
    pub bucket: String,
    /// Path of the blob inside the bucket.
    pub path: String,
    /// Storage tier the blob was registered in.
    pub tier: String,
    /// Expiry, Unix seconds.
    pub exp: u64,
}

/// Signs the payload: `{base64url(json)}.{base64url(hmac)}`.
#[must_use]
pub fn mint(payload: &BlobViewPayload, secret: &str) -> String {
    let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(payload).unwrap_or_default());
    let sig = sign(&body, secret);
    format!("{body}.{sig}")
}

/// The payload when the token's signature checks out and it has not expired.
#[must_use]
pub fn verify(token: &str, secret: &str, now_s: u64) -> Option<BlobViewPayload> {
    let (body, sig) = token.split_once('.')?;
    if body.is_empty() || sig.is_empty() {
        return None;
    }
    if !constant_time_eq(sig.as_bytes(), sign(body, secret).as_bytes()) {
        return None;
    }
    let json = URL_SAFE_NO_PAD.decode(body).ok()?;
    let payload: BlobViewPayload = serde_json::from_slice(&json).ok()?;
    let blank = [&payload.uid, &payload.bucket, &payload.path, &payload.tier]
        .iter()
        .any(|field| field.is_empty());
    if blank || payload.exp < now_s {
        return None;
    }
    Some(payload)
}

/// `{origin}/api/blobs/content?t=…` for a token that lives `ttl_s` seconds (rounded to a step).
#[allow(clippy::too_many_arguments)]
#[must_use]
pub fn content_url(
    origin: &str,
    uid: &str,
    bucket: &str,
    path: &str,
    tier: &str,
    ttl_s: u64,
    secret: &str,
    now_s: u64,
) -> String {
    let payload = BlobViewPayload {
        uid: uid.to_owned(),
        bucket: bucket.to_owned(),
        path: path.to_owned(),
        tier: tier.to_owned(),
        exp: view_token_exp(now_s, ttl_s),
    };
    let token = mint(&payload, secret);
    format!("{origin}/api/blobs/content?t={}", encode_component(&token))
}

/// Base64url HMAC-SHA256 of `body`.
fn sign(body: &str, secret: &str) -> String {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        // HMAC accepts a key of any length, so this branch cannot run.
        return String::new();
    };
    mac.update(body.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

/// Compares without stopping at the first differing byte.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Percent-encodes like JavaScript's `encodeURIComponent`.
fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

//! SDK uploads kept on this disk, served same-origin at `/artifacts/...` on the app host, and at
//! `app://artifacts/...` for URLs the Electron app recorded.
//!
//! Port of `apps/desktop/src/local-artifacts.ts`.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::protocol::{Reply, content_type_for};

/// Host the artifact URLs use.
pub const ARTIFACT_HOST: &str = "artifacts";

/// Prefix of every artifact URL this app records: `app://artifacts/{experiment_id}/{folder}/{name}`,
/// as in Electron; the web app reads and syncs records by this prefix.
pub const ARTIFACT_URL_PREFIX: &str = "app://artifacts/";

/// The same files on the app's own origin, `/artifacts/{experiment_id}/{folder}/{name}`, for
/// Windows webviews, which cannot load a second `app://` host under the page's `'self'` CSP.
pub const SAME_ORIGIN_PREFIX: &str = "/artifacts/";

/// An artifact runs nothing and loads nothing: an HTML or SVG upload opened on the app's origin
/// would otherwise run script next to the IPC bridge. A PDF is served as a download
/// (`application/octet-stream`, as in Electron), so no viewer runs under this policy.
pub const ARTIFACT_CSP: &str =
    "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/// Matches the web route's 25 MB cap. The writer does not enforce it; the caller does.
pub const MAX_LOCAL_ARTIFACT_BYTES: usize = 25 * 1024 * 1024;

/// Message for an unsafe experiment id or file name (byte-identical to the TS).
pub const UNSAFE: &str = "Unsafe artifact path.";

/// Longest allowed segment, in bytes (every allowed byte is ASCII, so bytes are characters).
const SEGMENT_MAX_LEN: usize = 128;

/// Gives each folder name a distinct counter value within one process.
static SEQ: AtomicU64 = AtomicU64::new(0);

/// True for 1 to 128 of `A-Za-z0-9._-`, and not `.` or `..`.
#[must_use]
pub fn is_safe_segment(value: &str) -> bool {
    (1..=SEGMENT_MAX_LEN).contains(&value.len())
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// A unique, UUID-shaped folder name (8-4-4-4-12 hex). Unique, not a secret: it is hashed from
/// the clock and a counter, so it must not be relied on to hide a file.
fn new_folder_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let mut hi = RandomState::new().build_hasher();
    hi.write_u128(nanos);
    hi.write_u64(seq);
    let mut lo = RandomState::new().build_hasher();
    lo.write_u64(seq);
    lo.write_u128(nanos);
    let bits = (u128::from(hi.finish()) << 64) | u128::from(lo.finish());
    let hex = format!("{bits:032x}");
    let part = |from: usize, to: usize| hex.get(from..to).unwrap_or_default();
    format!(
        "{}-{}-{}-{}-{}",
        part(0, 8),
        part(8, 12),
        part(12, 16),
        part(16, 20),
        part(20, 32)
    )
}

/// Saves `bytes` under `root/{experiment_id}/{folder}/{name}` and returns the URL to record.
pub fn write_local_artifact(
    root: &Path,
    experiment_id: &str,
    name: &str,
    bytes: &[u8],
) -> Result<String, String> {
    if !is_safe_segment(experiment_id) || !is_safe_segment(name) {
        return Err(UNSAFE.to_owned());
    }
    let folder = new_folder_name();
    let dir = root.join(experiment_id).join(&folder);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(name), bytes).map_err(|e| e.to_string())?;
    Ok(format!(
        "{ARTIFACT_URL_PREFIX}{experiment_id}/{folder}/{name}"
    ))
}

/// Serves one saved artifact. `path` is the URL path after the host, e.g. `/exp/uuid/name`.
#[must_use]
pub fn serve_local_artifact(root: &Path, path: &str) -> Reply {
    let Some(segments) = decode_segments(path) else {
        return bare(400);
    };
    let [experiment, folder, name] = segments.as_slice() else {
        return bare(404);
    };
    if !is_safe_segment(experiment) || !is_safe_segment(folder) || !is_safe_segment(name) {
        return bare(404);
    }
    let file = root.join(experiment).join(folder).join(name);
    match std::fs::read(&file) {
        Ok(body) => Reply {
            status: 200,
            headers: vec![
                ("content-type", content_type_for(&file).to_owned()),
                ("x-content-type-options", "nosniff".to_owned()),
                ("content-security-policy", ARTIFACT_CSP.to_owned()),
            ],
            body,
        },
        Err(_) => bare(404),
    }
}

/// An empty reply with only a status.
fn bare(status: u16) -> Reply {
    Reply {
        status,
        headers: Vec::new(),
        body: Vec::new(),
    }
}

/// Splits on `/`, drops empty pieces and decodes each; `None` if any escape is bad or not UTF-8.
fn decode_segments(path: &str) -> Option<Vec<String>> {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(percent_decode)
        .collect()
}

/// Decodes `%XX` escapes; `None` on a bad escape or bytes that are not UTF-8. `+` stays `+`.
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while let Some(&byte) = bytes.get(i) {
        if byte == b'%' {
            let hi = hex_value(*bytes.get(i + 1)?)?;
            let lo = hex_value(*bytes.get(i + 2)?)?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(byte);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The value of one ASCII hex digit.
fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

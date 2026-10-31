//! Blob content types and cold-tier eviction order, ported from
//! `packages/core/src/storage/blob-content-type.ts` and the pure parts of
//! `packages/core/src/storage/blob-tiering.ts`. Times are epoch ms; `now` is
//! passed in instead of read from the clock.

const MS_PER_DAY_F64: f64 = 86_400_000.0;

/// Hot (R2) or cold (OCI MinIO) storage tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlobTier {
    /// Hot tier (R2).
    Hot,
    /// Cold tier (OCI `MinIO`).
    Cold,
}

/// Registry row for a stored object (Postgres `blob_objects`).
#[derive(Debug, Clone, PartialEq)]
pub struct BlobObjectRecord {
    /// Storage bucket name.
    pub bucket: String,
    /// Object path inside the bucket.
    pub path: String,
    /// Tier the object currently lives in.
    pub tier: BlobTier,
    /// Object size in bytes.
    pub size_bytes: f64,
    /// Number of recorded accesses.
    pub access_count: f64,
    /// Epoch ms of the last access, if any.
    pub last_accessed_at: Option<i64>,
    /// 0 = tier off first, 100 = keep hot longest.
    pub priority: f64,
    /// Epoch ms when the object was registered.
    pub created_at: i64,
}

/// Tunable weights for the GDSF-inspired eviction score.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BlobTieringWeights {
    /// Days idle multiplier (LRU). Default 1.0.
    pub alpha: f64,
    /// Inverse-frequency multiplier (LFU). Default 30.0.
    pub beta: f64,
    /// Business-priority multiplier. Default 0.5.
    pub gamma: f64,
}

impl Default for BlobTieringWeights {
    fn default() -> Self {
        Self {
            alpha: 1.0,
            beta: 30.0,
            gamma: 0.5,
        }
    }
}

/// Guess MIME type from the text after the last `.` (case-insensitive), for
/// blob fetch and upload when no content-type header is available.
#[must_use]
pub fn guess_blob_content_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or_default().to_lowercase();
    match ext.as_str() {
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// Days from `last_ms` to `now_ms`, clamped at 0, as one division like the TS.
/// The ms count is rebuilt from two `u32` halves, exact below 2^53, so no
/// `as` cast is needed.
fn idle_days(last_ms: i64, now_ms: i64) -> f64 {
    let elapsed = now_ms.saturating_sub(last_ms).max(0);
    let high = f64::from(u32::try_from(elapsed >> 32).unwrap_or(u32::MAX));
    let low = f64::from(u32::try_from(elapsed & 0xFFFF_FFFF).unwrap_or(0));
    (high * 4_294_967_296.0 + low) / MS_PER_DAY_F64
}

/// Higher score means migrate to the cold tier first when R2 is near capacity.
///
/// `score = alpha * days_since_last_access + beta / log2(access_count + 2) + gamma * (100 - priority)`,
/// where the idle reference is `last_accessed_at`, falling back to `created_at`.
/// `weights` defaults to alpha 1, beta 30, gamma 0.5 when `None`.
#[must_use]
pub fn compute_blob_eviction_score(
    record: &BlobObjectRecord,
    now_ms: i64,
    weights: Option<&BlobTieringWeights>,
) -> f64 {
    let w = weights.copied().unwrap_or_default();
    let reference = record.last_accessed_at.unwrap_or(record.created_at);
    let days_idle = idle_days(reference, now_ms);
    let freq_term = w.beta / (record.access_count + 2.0).log2();
    let priority_term = w.gamma * (100.0 - record.priority);
    w.alpha * days_idle + freq_term + priority_term
}

/// Records sorted for eviction, highest score first. Stable for equal scores.
#[must_use]
pub fn rank_for_eviction<'a>(
    records: &'a [BlobObjectRecord],
    now_ms: i64,
    weights: Option<&BlobTieringWeights>,
) -> Vec<&'a BlobObjectRecord> {
    let mut scored: Vec<(f64, &BlobObjectRecord)> = records
        .iter()
        .map(|r| (compute_blob_eviction_score(r, now_ms, weights), r))
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.into_iter().map(|(_, r)| r).collect()
}

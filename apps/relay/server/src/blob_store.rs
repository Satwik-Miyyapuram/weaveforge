//! Blob registry rows, viewer lookups and tiered object operations, as the web's
//! `blob-registry.ts` and `blob-access.ts` do them.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use wf_core::storage::blob_access::{BlobRefusal, resource_id_from_path, shared_resource_for};

use crate::postgrest::{DbError, UserDb, eq, in_list};
use crate::routes::AppState;
use crate::s3::{S3Object, delete_object, get_object, put_object};
use crate::safe_error::{SERVER_FAULT, format_error_for_response};

const REGISTRY: &str = "blob_objects";

/// A blob failure, told apart by how the caller should be answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobError {
    /// Reply with this status and message.
    Status(u16, String),
    /// A database failure; the reply is formatted from it.
    Db(DbError),
    /// An object-store failure; logged, and the reply is generic.
    Store(String),
}

impl BlobError {
    /// The HTTP status to reply with.
    #[must_use]
    pub fn status(&self) -> u16 {
        match self {
            Self::Status(status, _) => *status,
            Self::Db(_) | Self::Store(_) => 500,
        }
    }

    /// The message to put in the reply body.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Status(_, message) => message.clone(),
            Self::Db(err) => format_error_for_response(err, "blobs"),
            Self::Store(_) => SERVER_FAULT.to_string(),
        }
    }
}

impl From<DbError> for BlobError {
    fn from(err: DbError) -> Self {
        Self::Db(err)
    }
}

impl From<BlobRefusal> for BlobError {
    fn from(refusal: BlobRefusal) -> Self {
        Self::Status(refusal.status, refusal.message.to_string())
    }
}

/// Unix time in whole seconds; 0 when the clock is before 1970.
#[must_use]
pub fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// The object-store key of a blob: `{bucket}/{path}`.
#[must_use]
pub fn object_key(bucket: &str, path: &str) -> String {
    format!("{bucket}/{path}")
}

/// Only `cold` is cold; any other stored value is hot.
fn tier_of(value: Option<&Value>) -> String {
    match value.and_then(Value::as_str) {
        Some("cold") => "cold".to_string(),
        _ => "hot".to_string(),
    }
}

/// The tier of one blob, or None when it has no registry row.
pub async fn registry_tier(
    db: &UserDb<'_>,
    bucket: &str,
    path: &str,
) -> Result<Option<String>, DbError> {
    let rows = db
        .select(
            REGISTRY,
            &[
                ("select", "tier".to_string()),
                ("bucket", eq(bucket)),
                ("path", eq(path)),
            ],
        )
        .await?;
    Ok(rows.first().map(|row| tier_of(row.get("tier"))))
}

/// The tiers of many blobs in one query, keyed by path; paths with no row are absent.
pub async fn registry_tiers(
    db: &UserDb<'_>,
    bucket: &str,
    paths: &[String],
) -> Result<HashMap<String, String>, DbError> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = db
        .select(
            REGISTRY,
            &[
                ("select", "path,tier".to_string()),
                ("bucket", eq(bucket)),
                ("path", in_list(paths)),
            ],
        )
        .await?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let path = row.get("path")?.as_str()?;
            Some((path.to_string(), tier_of(row.get("tier"))))
        })
        .collect())
}

/// Records a new hot blob, or resets an existing row for the same bucket and path.
pub async fn registry_register(
    db: &UserDb<'_>,
    bucket: &str,
    path: &str,
    size_bytes: u64,
) -> Result<(), DbError> {
    let row = json!({
        "bucket": bucket,
        "path": path,
        "tier": "hot",
        "size_bytes": size_bytes,
        "priority": 50
    });
    let _saved = db
        .upsert(
            REGISTRY,
            &row,
            &[("on_conflict", "bucket,path".to_string())],
        )
        .await?;
    Ok(())
}

/// Drops the registry row of one blob.
pub async fn registry_remove(db: &UserDb<'_>, bucket: &str, path: &str) -> Result<(), DbError> {
    db.delete(REGISTRY, &[("bucket", eq(bucket)), ("path", eq(path))])
        .await
}

/// Bumps the access count of many blobs; a failure is logged and ignored.
pub async fn record_access_many(db: &UserDb<'_>, bucket: &str, paths: &[String]) {
    if paths.is_empty() {
        return;
    }
    let args = json!({"p_bucket": bucket, "p_paths": paths});
    if let Err(err) = db.rpc("record_blob_access_many", &args).await {
        eprintln!("[blobs] record access failed: {}", err.message);
    }
}

/// The tier a viewer may read a blob at, or None when they may not.
///
/// The owner always may. Anyone else may when the resource the blob belongs to is
/// shared with them. Looks up with the service-role key, as the web does.
pub async fn viewer_tier(
    state: &AppState,
    bucket: &str,
    path: &str,
    viewer: &str,
) -> Result<Option<String>, DbError> {
    let db = UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.service_role_key,
        &state.config.service_role_key,
    );
    let rows = db
        .select(
            REGISTRY,
            &[
                ("select", "user_id,tier".to_string()),
                ("bucket", eq(bucket)),
                ("path", eq(path)),
            ],
        )
        .await?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let tier = tier_of(row.get("tier"));
    if row.get("user_id").and_then(Value::as_str) == Some(viewer) {
        return Ok(Some(tier));
    }
    let (Some(rtype), Some(rid)) = (shared_resource_for(bucket), resource_id_from_path(path))
    else {
        return Ok(None);
    };
    let args = json!({"rtype": rtype, "rid": rid, "uid": viewer});
    let shared = db.rpc("shared_to_user", &args).await?;
    Ok((shared == Value::Bool(true)).then_some(tier))
}

/// Logs an object-store failure and makes it the error to return.
fn store_failure(message: String) -> BlobError {
    eprintln!("[blobs] {message}");
    BlobError::Store(message)
}

/// Stores a blob in the hot tier and registers it.
pub async fn upload(
    state: &AppState,
    db: &UserDb<'_>,
    bucket: &str,
    path: &str,
    body: Vec<u8>,
    content_type: &str,
) -> Result<(), BlobError> {
    let target = state
        .storage
        .target_for("hot")
        .map_err(|message| BlobError::Status(500, message))?;
    let size = u64::try_from(body.len()).unwrap_or(u64::MAX);
    let key = object_key(bucket, path);
    put_object(
        &state.client,
        target,
        &key,
        body,
        content_type,
        now_seconds(),
    )
    .await
    .map_err(store_failure)?;
    registry_register(db, bucket, path, size).await?;
    Ok(())
}

/// Deletes a blob from the tier it is in, then drops its registry row.
pub async fn remove(
    state: &AppState,
    db: &UserDb<'_>,
    bucket: &str,
    path: &str,
) -> Result<(), BlobError> {
    let tier = registry_tier(db, bucket, path)
        .await?
        .unwrap_or_else(|| "hot".to_string());
    let target = state
        .storage
        .target_for(&tier)
        .map_err(|message| BlobError::Status(500, message))?;
    let key = object_key(bucket, path);
    delete_object(&state.client, target, &key, now_seconds())
        .await
        .map_err(store_failure)?;
    registry_remove(db, bucket, path).await?;
    Ok(())
}

/// Reads a blob from the given tier; None when the object is not there.
pub async fn read(
    state: &AppState,
    bucket: &str,
    path: &str,
    tier: &str,
) -> Result<Option<S3Object>, BlobError> {
    let target = state
        .storage
        .target_for(tier)
        .map_err(|message| BlobError::Status(500, message))?;
    let key = object_key(bucket, path);
    Ok(get_object(&state.client, target, &key, now_seconds()).await)
}

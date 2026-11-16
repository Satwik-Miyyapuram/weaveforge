//! Removes a user's stored files and blob registry rows before the account is deleted,
//! as the web's `purge-user-blobs.ts` does.

use reqwest::Method;
use serde_json::{Value, json};

use crate::blob_store;
use crate::postgrest::{UserDb, eq};
use crate::routes::AppState;

/// The buckets that hold a user's files, each keyed by a `{user_id}/` prefix.
pub const BLOB_STORAGE_BUCKETS: [&str; 5] = [
    "paper-images",
    "experiment-artifacts",
    "vault-assets",
    "report-images",
    "log-images",
];

/// Storage listing page size.
const PAGE: usize = 200;

/// Deletes every stored file and registry row of `user_id`. Rows are dropped only when
/// every tiered delete succeeded, so a retry can still find what is left.
pub async fn purge_user_blobs(state: &AppState, user_id: &str) -> Result<(), String> {
    let db = UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.service_role_key,
        &state.config.service_role_key,
    );
    let rows = db
        .select(
            "blob_objects",
            &[
                ("select", "bucket,path".to_string()),
                ("user_id", eq(user_id)),
            ],
        )
        .await
        .map_err(|err| err.message)?;
    let total = rows.len();
    let mut failed = 0usize;
    if state.storage.tiered {
        for row in &rows {
            let bucket = row
                .get("bucket")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let path = row.get("path").and_then(Value::as_str).unwrap_or_default();
            if blob_store::remove(state, &db, bucket, path).await.is_err() {
                failed += 1;
            }
        }
    }
    for bucket in BLOB_STORAGE_BUCKETS {
        remove_storage_prefix(state, bucket, user_id).await?;
    }
    if failed > 0 {
        return Err(format!(
            "Could not delete {failed} of {total} stored objects — account not deleted. Retry once object storage is reachable."
        ));
    }
    db.delete("blob_objects", &[("user_id", eq(user_id))])
        .await
        .map_err(|err| err.message)
}

/// Deletes every file under `bucket/prefix`, walking folders, in one batch.
async fn remove_storage_prefix(state: &AppState, bucket: &str, prefix: &str) -> Result<(), String> {
    let paths = collect_paths(state, bucket, prefix).await?;
    if paths.is_empty() {
        return Ok(());
    }
    storage_call(
        state,
        Method::DELETE,
        &format!("/object/{bucket}"),
        &json!({ "prefixes": paths }),
    )
    .await
    .map(|_| ())
}

/// Every file path under `prefix`; folders (entries with a null `id`) are listed in turn.
async fn collect_paths(
    state: &AppState,
    bucket: &str,
    prefix: &str,
) -> Result<Vec<String>, String> {
    let mut queue = vec![prefix.to_string()];
    let mut paths = Vec::new();
    while let Some(current) = queue.pop() {
        let mut offset = 0;
        loop {
            let entries = list_page(state, bucket, &current, offset).await?;
            let count = entries.len();
            for entry in entries {
                let Some(name) = entry.get("name").and_then(Value::as_str) else {
                    continue;
                };
                let full = if current.is_empty() {
                    name.to_string()
                } else {
                    format!("{current}/{name}")
                };
                if entry.get("id").is_some_and(|id| !id.is_null()) {
                    paths.push(full);
                } else {
                    queue.push(full);
                }
            }
            if count < PAGE {
                break;
            }
            offset += PAGE;
        }
    }
    Ok(paths)
}

/// One page of the entries directly under `prefix`.
async fn list_page(
    state: &AppState,
    bucket: &str,
    prefix: &str,
    offset: usize,
) -> Result<Vec<Value>, String> {
    let body = json!({
        "prefix": prefix,
        "limit": PAGE,
        "offset": offset,
        "sortBy": { "column": "name", "order": "asc" },
    });
    match storage_call(
        state,
        Method::POST,
        &format!("/object/list/{bucket}"),
        &body,
    )
    .await?
    {
        Value::Array(entries) => Ok(entries),
        _ => Err("Storage request failed.".to_string()),
    }
}

/// One service-role call to Supabase Storage; a non-2xx reply becomes its message.
async fn storage_call(
    state: &AppState,
    method: Method,
    path: &str,
    body: &Value,
) -> Result<Value, String> {
    let key = state.config.service_role_key.as_str();
    let unreachable = || "Could not reach object storage.".to_string();
    let response = state
        .client
        .request(
            method,
            format!("{}/storage/v1{path}", state.config.supabase_url),
        )
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| unreachable())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|_| unreachable())?;
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if status.is_success() {
        Ok(value)
    } else {
        Err(storage_message(&value))
    }
}

/// The `message` or `error` text of a storage error body.
fn storage_message(body: &Value) -> String {
    ["message", "error"]
        .iter()
        .find_map(|key| body.get(*key).and_then(Value::as_str))
        .unwrap_or("Storage request failed.")
        .to_string()
}

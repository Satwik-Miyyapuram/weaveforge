//! The Overleaf report content route: `/api/overleaf/reports/{id}/content`.
//! Ported from apps/web/src/app/api/overleaf/reports/[id]/content/_content.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde_json::{Map, Value, json};
use wf_core::overleaf_workshop::safe_overleaf_error;
use wf_core::sync::instant::format_instant;

use crate::credential_crypto::open;
use crate::overleaf_git::{OverleafRead, read_overleaf_project};
use crate::postgrest::{DbError, UserDb, eq};
use crate::routes::AppState;
use crate::sdk::{caller, db_failure, error_response, json_response, no_store, user_db};

const REPORTS: &str = "overleaf_linked_reports";
const CONNECTIONS: &str = "overleaf_connections";
const CONTEXT: &str = "overleaf-content";
const REPORT_NOT_FOUND: &str = "Linked Overleaf report not found.";
const CONNECTION_UNAVAILABLE: &str = "Overleaf connection is unavailable.";

/// The columns of a linked report that the content read needs.
struct LinkedReport {
    project_id: String,
    entry_file: String,
    connection_id: String,
}

/// `GET /api/overleaf/reports/{id}/content`: clone the linked Overleaf project and return its text and outline.
pub async fn content_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let db = user_db(&state, &caller);
    let report = match find_report(&db, &caller.user_id, &id).await {
        Ok(Some(report)) => report,
        Ok(None) => return error_response(404, REPORT_NOT_FOUND),
        Err(err) => return db_failure(&err, CONTEXT),
    };
    let ciphertext = match find_ciphertext(&db, &caller.user_id, &report.connection_id).await {
        Ok(Some(ciphertext)) => ciphertext,
        Ok(None) => return error_response(404, CONNECTION_UNAVAILABLE),
        Err(err) => return db_failure(&err, CONTEXT),
    };
    let key = state.settings.credential_key.as_deref();
    let token = match open(&ciphertext, key) {
        Ok(token) => token,
        Err(message) => return failure(&db, &caller.user_id, &id, &message, None).await,
    };
    let read = read_overleaf_project(
        &state.settings.overleaf_git_base,
        &report.project_id,
        &report.entry_file,
        &token,
    )
    .await;
    match read {
        Ok(read) => success(&db, &caller.user_id, &id, &read).await,
        Err(message) => failure(&db, &caller.user_id, &id, &message, Some(&token)).await,
    }
}

/// The caller's linked report `id`, when it is enabled; `None` when no row matches.
async fn find_report(
    db: &UserDb<'_>,
    user_id: &str,
    id: &str,
) -> Result<Option<LinkedReport>, DbError> {
    let query = [
        (
            "select",
            "id,overleaf_project_id,entry_file,external_url,connection_id".to_string(),
        ),
        ("id", eq(id)),
        ("user_id", eq(user_id)),
        ("enabled", eq("true")),
    ];
    let rows = db.select(REPORTS, &query).await?;
    Ok(rows.first().map(|row| LinkedReport {
        project_id: field(row, "overleaf_project_id"),
        entry_file: field(row, "entry_file"),
        connection_id: field(row, "connection_id"),
    }))
}

/// The sealed token of the caller's enabled connection `connection_id`; `None` when unavailable.
async fn find_ciphertext(
    db: &UserDb<'_>,
    user_id: &str,
    connection_id: &str,
) -> Result<Option<String>, DbError> {
    let query = [
        ("select", "token_ciphertext".to_string()),
        ("id", eq(connection_id)),
        ("user_id", eq(user_id)),
        ("enabled", eq("true")),
    ];
    let rows = db.select(CONNECTIONS, &query).await?;
    Ok(rows
        .first()
        .and_then(|row| row.get("token_ciphertext"))
        .and_then(Value::as_str)
        .map(str::to_owned))
}

/// The string at `key` of `row`; empty when missing or not a string.
fn field(row: &Value, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned()
}

/// The `WHERE` filters for the caller's report `id`.
fn report_query(id: &str, user_id: &str) -> [(&'static str, String); 2] {
    [("id", eq(id)), ("user_id", eq(user_id))]
}

/// Records the fetch time and clears the last error, then replies with the sources and outline.
async fn success(db: &UserDb<'_>, user_id: &str, id: &str, read: &OverleafRead) -> Response {
    let patch = json!({"last_fetched_at": now_iso(), "last_error": null});
    let _updated = db.update(REPORTS, &report_query(id, user_id), &patch).await;
    no_store(json_response(200, &content_body(id, read)))
}

/// Records the failure (secrets removed) and replies 502 with the same message.
async fn failure(
    db: &UserDb<'_>,
    user_id: &str,
    id: &str,
    raw: &str,
    secret: Option<&str>,
) -> Response {
    let message = safe_overleaf_error(raw, secret);
    let patch = json!({"last_error": message});
    let _updated = db.update(REPORTS, &report_query(id, user_id), &patch).await;
    no_store(json_response(502, &json!({"error": message})))
}

/// The reply body: `reportId` first, then every field of the read.
fn content_body(id: &str, read: &OverleafRead) -> Value {
    let mut body = Map::new();
    let _old = body.insert("reportId".to_owned(), json!(id));
    if let Ok(Value::Object(fields)) = serde_json::to_value(read) {
        body.extend(fields);
    }
    Value::Object(body)
}

/// The current time as an ISO-8601 string, for `last_fetched_at`.
fn now_iso() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    format_instant(i64::try_from(millis).unwrap_or(0))
}

//! The MCP relay routes: the pairing notice on `/api/mcp` and the request queue on `/api/mcp/relay*`.
//! Ported from apps/web/src/app/api/mcp/{route.ts,relay/route.ts,relay/browser/route.ts}.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::CONTENT_LENGTH;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Uri};
use axum::response::Response;
use serde_json::{Map, Value, json};
use wf_core::mcp::{exceeds_declared_limit, is_uuid, relay_ttl_ms, tool_manifest, valid_envelope};
use wf_core::sync::instant::{format_instant, parse_instant};

use crate::postgrest::eq;
use crate::routes::AppState;
use crate::sdk::{
    db_failure, error_response, json_response, mcp_caller, no_store, query_param, user_db,
};

const TABLE: &str = "ai_mcp_relay_requests";
/// Requests one browser poll may claim at a time.
const CLAIM_LIMIT: i64 = 5;

/// `GET /api/mcp`: the pairing notice, with the tool list.
pub async fn mcp_get(State(state): State<Arc<AppState>>) -> Response {
    pairing_required(&state)
}

/// `POST /api/mcp`: the same pairing notice as `GET`.
pub async fn mcp_post(State(state): State<Arc<AppState>>) -> Response {
    pairing_required(&state)
}

/// `POST /api/mcp/relay`: queue an encrypted request for the paired browser to claim.
pub async fn relay_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !state.settings.mcp_enabled {
        return disabled();
    }
    let caller = match mcp_caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    if too_large(&headers) {
        return error_response(413, "Relay body is too large.");
    }
    let fields = match object_body(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let envelope = fields.get("envelope").cloned().unwrap_or(Value::Null);
    let session = fields.get("sessionId");
    if !truthy(session) || !valid_envelope(&envelope) {
        return error_response(400, "sessionId and encrypted envelope are required.");
    }
    let Some(session_id) = session.and_then(Value::as_str).filter(|id| is_uuid(id)) else {
        return error_response(400, "sessionId must be a UUID.");
    };
    let ttl = relay_ttl_ms(fields.get("ttlMs"));
    let row = json!({
        "user_id": caller.user_id,
        "session_id": session_id,
        "request_enc": envelope,
        "expires_at": format_instant(now_ms().saturating_add(ttl)),
    });
    let query = [("select", "id, status, expires_at".to_string())];
    match user_db(&state, &caller)
        .insert_returning(TABLE, &row, &query)
        .await
    {
        Ok(rows) => no_store(json_response(201, &json!({"request": first_row(rows)}))),
        Err(err) => db_failure(&err, "mcp-relay"),
    }
}

/// `GET /api/mcp/relay?id=`: one relay request; a pending one past its expiry reads as expired.
pub async fn relay_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    if !state.settings.mcp_enabled {
        return disabled();
    }
    let caller = match mcp_caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(id) = raw_query_param(&uri, "id") else {
        return error_response(400, "id is required.");
    };
    if !is_uuid(&id) {
        return error_response(400, "id must be a UUID.");
    }
    let query = [
        ("select", "id, status, response_enc, expires_at".to_string()),
        ("id", eq(&id)),
    ];
    let mut row = match user_db(&state, &caller).select(TABLE, &query).await {
        Ok(rows) => first_row(rows),
        Err(_) => Value::Null,
    };
    if row.is_null() {
        return error_response(404, "Relay request not found.");
    }
    expire_if_stale(&mut row, now_ms());
    no_store(json_response(200, &json!({"request": row})))
}

/// `PATCH /api/mcp/relay`: the browser's reply to a claimed request, or its cancellation.
pub async fn relay_patch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !state.settings.mcp_enabled {
        return disabled();
    }
    let caller = match mcp_caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    if too_large(&headers) {
        return error_response(413, "Relay body is too large.");
    }
    let fields = match object_body(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let cancelled = fields.get("status").and_then(Value::as_str) == Some("cancelled");
    let envelope = fields.get("envelope").cloned().unwrap_or(Value::Null);
    if !truthy(fields.get("id")) || (!cancelled && !valid_envelope(&envelope)) {
        return error_response(400, "id and encrypted response are required.");
    }
    let Some(id) = fields
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| is_uuid(id))
    else {
        return error_response(400, "id must be a UUID.");
    };
    let now = now_ms();
    let patch = json!({
        "status": patch_status(fields.get("status")),
        "response_enc": if cancelled { Value::Null } else { envelope },
        "completed_at": format_instant(now),
    });
    let query = claimable_query(id, now);
    match user_db(&state, &caller)
        .update_returning(TABLE, &query, &patch)
        .await
    {
        Ok(rows) if rows.is_empty() => error_response(409, "Relay request is no longer claimable."),
        Ok(_) => no_store(json_response(200, &json!({"ok": true}))),
        Err(err) => db_failure(&err, "mcp-relay"),
    }
}

/// `GET /api/mcp/relay/browser?sessionId=`: claims up to five queued requests for the session.
pub async fn browser_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    if !state.settings.mcp_enabled {
        return disabled();
    }
    let caller = match mcp_caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(session_id) = query_param(&uri, "sessionId") else {
        return error_response(400, "sessionId is required.");
    };
    if !is_uuid(&session_id) {
        return error_response(400, "sessionId must be a UUID.");
    }
    let args = json!({"p_session_id": session_id, "p_limit": CLAIM_LIMIT});
    match user_db(&state, &caller)
        .rpc("claim_ai_mcp_relay_requests", &args)
        .await
    {
        Ok(Value::Null) => no_store(json_response(200, &json!({"requests": []}))),
        Ok(requests) => no_store(json_response(200, &json!({"requests": requests}))),
        Err(err) => db_failure(&err, "mcp-relay-browser"),
    }
}

/// The 503 pairing notice, with the tool list; never cached and kept out of search.
fn pairing_required(state: &AppState) -> Response {
    if !state.settings.mcp_enabled {
        return disabled();
    }
    let mut response = no_store(json_response(
        503,
        &json!({
            "error": "browser_pairing_required",
            "message": "Open WeaveForge and unlock encryption to access this workspace.",
            "tools": tool_manifest(),
        }),
    ));
    let _old = response.headers_mut().insert(
        HeaderName::from_static("x-robots-tag"),
        HeaderValue::from_static("noindex"),
    );
    response
}

/// The 404 for MCP routes while MCP is switched off; never cached.
fn disabled() -> Response {
    no_store(json_response(404, &json!({"error": "mcp_disabled"})))
}

/// Whether the declared `Content-Length` is over the relay body limit.
fn too_large(headers: &HeaderMap) -> bool {
    exceeds_declared_limit(
        headers
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok()),
    )
}

/// The JSON body as an object; a 400 reply for anything else.
fn object_body(body: &[u8]) -> Result<Map<String, Value>, Response> {
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(fields)) => Ok(fields),
        Ok(_) => Err(error_response(400, "The body must be a JSON object.")),
        Err(err) => Err(error_response(400, &format!("Invalid JSON body: {err}"))),
    }
}

/// JavaScript truthiness of a JSON field: absent, null, false, "" and 0 are falsy.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Number(number)) => number.as_f64().is_some_and(|f| f != 0.0),
        Some(_) => true,
    }
}

/// The status to write: the body's `status` when it is set, else `complete`.
fn patch_status(status: Option<&Value>) -> Value {
    match status {
        Some(value) if !value.is_null() => value.clone(),
        _ => json!("complete"),
    }
}

/// The filter for a request that is still claimed and has not expired yet.
fn claimable_query(id: &str, now: i64) -> [(&'static str, String); 4] {
    [
        ("id", eq(id)),
        ("status", eq("claimed")),
        ("expires_at", format!("gt.{}", format_instant(now))),
        ("select", "id".to_string()),
    ]
}

/// Marks a pending request whose expiry has passed as expired, in the reply only.
fn expire_if_stale(row: &mut Value, now: i64) {
    let pending = row.get("status").and_then(Value::as_str) == Some("pending");
    let expires = row
        .get("expires_at")
        .and_then(Value::as_str)
        .and_then(parse_instant);
    if pending && expires.is_some_and(|at| at <= now) {
        row["status"] = json!("expired");
    }
}

/// The raw value of query parameter `name`, untrimmed; `None` when missing or empty.
fn raw_query_param(uri: &Uri, name: &str) -> Option<String> {
    let query = uri.query()?;
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
}

/// The first row of a read, or null when there is none.
fn first_row(rows: Vec<Value>) -> Value {
    rows.into_iter().next().unwrap_or(Value::Null)
}

/// Milliseconds since the Unix epoch.
fn now_ms() -> i64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    i64::try_from(millis).unwrap_or(0)
}

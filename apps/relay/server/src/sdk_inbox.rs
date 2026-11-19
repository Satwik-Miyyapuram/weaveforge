//! The SDK inbox: while `SDK_INBOX=1`, SDK metrics and artifact JSON are queued as
//! `sdk_inbox` rows instead of written to their tables. The desktop app claims rows
//! with `GET /api/sdk/inbox` and deletes them with `POST /api/sdk/inbox/ack`.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, Uri};
use axum::response::Response;
use serde_json::{Value, json};

use crate::auth::{Caller, require_session};
use crate::postgrest::UserDb;
use crate::routes::AppState;
use crate::sdk::{db_failure, error_response, json_response, query_param, user_db};

/// Most rows one claim returns.
pub const INBOX_CLAIM_LIMIT: i64 = 100;
/// Most ids one ack may name.
const ACK_ID_LIMIT: usize = 500;
/// Longest device name the claim accepts, in characters.
const DEVICE_LIMIT: usize = 200;
/// Largest stored payload, in serialized bytes, after binary fields are dropped.
pub const INBOX_PAYLOAD_LIMIT: usize = 256 * 1024;
/// Fields that carry file bytes; refused, never queued.
const BINARY_FIELDS: [&str; 2] = ["dataBase64", "data"];

/// Whether the inbox is on (`SDK_INBOX=1`); read on every call.
#[must_use]
pub fn enabled() -> bool {
    std::env::var("SDK_INBOX").is_ok_and(|value| value == "1")
}

/// Queues one JSON object as an inbox row of `kind`; answers 202.
/// A binary field (file bytes) answers 415 and is not queued, since the inbox
/// stores metadata only and dropping the bytes would lose the file. A payload
/// over the limit answers 413.
pub async fn enqueue(db: &UserDb<'_>, kind: &str, body: Option<Value>) -> Response {
    let Some(body) = body.filter(Value::is_object) else {
        return error_response(400, "Invalid JSON body.");
    };
    if BINARY_FIELDS.iter().any(|field| body.get(*field).is_some()) {
        return error_response(415, "Binary fields are not accepted while the inbox is on.");
    }
    let size = serde_json::to_vec(&body).map_or(usize::MAX, |bytes| bytes.len());
    if size > INBOX_PAYLOAD_LIMIT {
        return error_response(413, "Payload too large.");
    }
    let experiment_id = body
        .get("experiment_id")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let row = json!({"kind": kind, "experiment_id": experiment_id, "payload": body});
    match db.insert("sdk_inbox", &row).await {
        Ok(()) => json_response(202, &json!({"queued": true})),
        Err(err) => db_failure(&err, "sdk-inbox"),
    }
}

/// `GET /api/sdk/inbox`: claim the caller's queued rows after `after` for `device`.
pub async fn inbox_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let after = match query_param(&uri, "after") {
        None => 0,
        Some(raw) => match raw.parse::<i64>() {
            Ok(number) if number >= 0 => number,
            _ => return error_response(400, "Invalid after."),
        },
    };
    let device = match query_param(&uri, "device") {
        Some(device) if device.chars().count() <= DEVICE_LIMIT => device,
        _ => return error_response(400, "Missing device."),
    };
    let db = user_db(&state, &caller);
    let args = json!({"p_after": after, "p_device": device, "p_limit": INBOX_CLAIM_LIMIT});
    match db.rpc("sdk_inbox_claim", &args).await {
        Ok(rows) => {
            let items = if rows.is_array() { rows } else { json!([]) };
            json_response(200, &json!({"items": items}))
        }
        Err(err) => db_failure(&err, "sdk-inbox"),
    }
}

/// `POST /api/sdk/inbox/ack`: delete the rows named in `{"ids": [...], "device": ...}`
/// that this device claimed.
pub async fn inbox_ack(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(ids) = parse_ids(&body) else {
        return error_response(400, "Invalid ids.");
    };
    let Some(device) = parse_device(&body) else {
        return error_response(400, "Missing device.");
    };
    if ids.len() > ACK_ID_LIMIT {
        return error_response(400, "At most 500 ids per request.");
    }
    if ids.is_empty() {
        return json_response(200, &json!({"ok": true}));
    }
    // Ids are integers, so the list needs no quoting.
    let list = format!(
        "in.({})",
        ids.iter()
            .map(i64::to_string)
            .collect::<Vec<String>>()
            .join(",")
    );
    let db = user_db(&state, &caller);
    let claimed = format!("eq.{device}");
    match db.delete("sdk_inbox", &[("id", list), ("claimed_by", claimed)]).await {
        Ok(()) => json_response(200, &json!({"ok": true})),
        Err(err) => db_failure(&err, "sdk-inbox"),
    }
}

/// A signed-in session, or the refusal reply. API tokens are refused here.
async fn session(state: &AppState, headers: &HeaderMap) -> Result<Caller, Response> {
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    require_session(&state.client, &state.config, authorization)
        .await
        .map_err(|err| error_response(err.status, &err.message))
}

/// The integer ids in `{"ids": [...]}`; `None` when missing or any is not an integer.
fn parse_ids(body: &[u8]) -> Option<Vec<i64>> {
    let value: Value = serde_json::from_slice(body).ok()?;
    value
        .get("ids")?
        .as_array()?
        .iter()
        .map(Value::as_i64)
        .collect()
}

/// The `device` in an ack body: a non-empty string of at most `DEVICE_LIMIT` characters.
fn parse_device(body: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let device = value.get("device")?.as_str()?;
    (!device.is_empty() && device.chars().count() <= DEVICE_LIMIT).then(|| device.to_owned())
}

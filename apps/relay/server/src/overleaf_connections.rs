//! The Overleaf connection routes: `/api/overleaf/connections`.
//! Ported from apps/web/src/app/api/overleaf/connections/route.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Uri};
use axum::response::Response;
use serde_json::{Value, json};

use crate::credential_crypto::seal;
use crate::postgrest::eq;
use crate::routes::AppState;
use crate::sdk::{
    caller, db_failure, error_response, json_response, no_store, query_param, user_db,
};

const TABLE: &str = "overleaf_connections";
const FIELDS: &str = "id,name,token_prefix,enabled,created_at,updated_at";
const CONTEXT: &str = "overleaf-connections";

/// `GET /api/overleaf/connections`: the caller's Overleaf connections, newest update first.
pub async fn connections_get(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let query = [
        ("select", FIELDS.to_string()),
        ("order", "updated_at.desc".to_string()),
    ];
    match user_db(&state, &caller).select(TABLE, &query).await {
        Ok(rows) => no_store(json_response(200, &json!({"connections": rows}))),
        Err(err) => db_failure(&err, CONTEXT),
    }
}

/// `POST /api/overleaf/connections`: seal and store a named Overleaf token.
pub async fn connections_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let parsed = match serde_json::from_slice::<Value>(&body) {
        Ok(parsed) => parsed,
        Err(err) => return error_response(400, &format!("Invalid JSON body: {err}")),
    };
    let name = text_field(&parsed, "name");
    let token = text_field(&parsed, "token");
    if name.is_empty() || token.is_empty() {
        return error_response(400, "Connection name and token are required.");
    }
    // Seal before any database call so a missing key writes nothing.
    let envelope = match seal(&token, state.settings.credential_key.as_deref()) {
        Ok(envelope) => envelope,
        Err(message) => return error_response(503, &message),
    };
    let row = json!({
        "user_id": caller.user_id,
        "name": name,
        "token_ciphertext": envelope,
        "token_prefix": token.chars().take(4).collect::<String>(),
    });
    let query = [("select", FIELDS.to_string())];
    let db = user_db(&state, &caller);
    match db.insert_returning(TABLE, &row, &query).await {
        Ok(rows) => {
            let connection = rows.into_iter().next().unwrap_or(Value::Null);
            no_store(json_response(201, &json!({"connection": connection})))
        }
        Err(err) => db_failure(&err, CONTEXT),
    }
}

/// `DELETE /api/overleaf/connections?id=`: delete the connection with that id.
pub async fn connections_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(id) = query_param(&uri, "id") else {
        return error_response(400, "Connection id required.");
    };
    match user_db(&state, &caller)
        .delete(TABLE, &[("id", eq(&id))])
        .await
    {
        Ok(()) => json_response(200, &json!({"ok": true})),
        Err(err) => db_failure(&err, CONTEXT),
    }
}

/// The trimmed string field `key` of a JSON body; a missing or non-string field is empty.
fn text_field(body: &Value, key: &str) -> String {
    body.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned()
}

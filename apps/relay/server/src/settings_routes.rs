//! The settings token routes: SDK API tokens and MCP tokens, ported from
//! apps/web/src/app/api/settings/{api-tokens,mcp-tokens}/route.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL};
use axum::http::{HeaderMap, HeaderValue, Uri};
use axum::response::Response;
use serde_json::{Value, json};

use crate::api_tokens::{TOKEN_COLUMNS, expiry_from_days, generate_token, is_expiry_days, map_row};
use crate::auth::{Caller, bearer_token, require_session};
use crate::postgrest::{DbError, UserDb, eq};
use crate::routes::AppState;
use crate::sdk::{db_failure, error_response, json_response, query_param, user_db};

const NOT_AUTHENTICATED: &str = "Not authenticated.";
const EXPIRY_INVALID: &str = "expiresInDays must be a whole number of days (0 to 36500), or null.";
const MCP_SCOPE: &str = "mcp_relay";

/// `GET /api/settings/api-tokens`: the caller's SDK API tokens, newest first.
pub async fn api_tokens_get(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !has_bearer(&headers) {
        return error_response(401, NOT_AUTHENTICATED);
    }
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match list(&user_db(&state, &caller)).await {
        Ok(tokens) => json_response(200, &json!({"tokens": tokens})),
        Err(err) => db_failure(&err, "api-tokens"),
    }
}

/// `POST /api/settings/api-tokens`: mint an SDK API token; the plaintext is returned once.
pub async fn api_tokens_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !has_bearer(&headers) {
        return error_response(401, NOT_AUTHENTICATED);
    }
    let body = match serde_json::from_slice::<Value>(&body) {
        Ok(body) => body,
        Err(err) => return error_response(400, &format!("Invalid JSON body: {err}")),
    };
    if !body.is_object() && !body.is_array() {
        return error_response(400, "Expected a JSON object body.");
    }
    let expires = body.get("expiresInDays");
    if !is_expiry_days(expires) {
        return error_response(400, EXPIRY_INVALID);
    }
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if name.is_empty() {
        return error_response(400, "Token name is required.");
    }
    let generated = match generate_token() {
        Ok(generated) => generated,
        Err(message) => return error_response(500, &message),
    };
    let row = json!({
        "user_id": caller.user_id,
        "name": name,
        "token_hash": generated.hash_bytea,
        "token_prefix": generated.prefix,
        "expires_at": expiry_from_days(expires, now_ms()),
        "scopes": ["sdk"],
    });
    match insert_token(&state, &caller, &row, "api-tokens").await {
        Ok(saved) => created(&saved, &generated.plaintext),
        Err(response) => response,
    }
}

/// `DELETE /api/settings/api-tokens?id=`: revoke one of the caller's SDK API tokens.
pub async fn api_tokens_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    remove_token(&state, &headers, &uri, "api-tokens").await
}

/// `GET /api/settings/mcp-tokens`: the caller's MCP tokens, newest first.
pub async fn mcp_tokens_get(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !state.settings.mcp_enabled {
        return disabled();
    }
    if !has_bearer(&headers) {
        return error_response(401, NOT_AUTHENTICATED);
    }
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match list(&user_db(&state, &caller)).await {
        Ok(tokens) => {
            let mcp: Vec<Value> = tokens
                .into_iter()
                .filter(|token| token["scopes"] == json!([MCP_SCOPE]))
                .collect();
            json_response(200, &json!({"tokens": mcp}))
        }
        Err(err) => db_failure(&err, "mcp-tokens"),
    }
}

/// `POST /api/settings/mcp-tokens`: mint the token the Codex MCP connection uses.
pub async fn mcp_tokens_post(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if !state.settings.mcp_enabled {
        return disabled();
    }
    if !has_bearer(&headers) {
        return error_response(401, NOT_AUTHENTICATED);
    }
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let generated = match generate_token() {
        Ok(generated) => generated,
        Err(message) => return error_response(500, &message),
    };
    let row = json!({
        "user_id": caller.user_id,
        "name": "Codex MCP connection",
        "token_hash": generated.hash_bytea,
        "token_prefix": generated.prefix,
        "scopes": [MCP_SCOPE],
        "expires_at": null,
    });
    match insert_token(&state, &caller, &row, "mcp-tokens").await {
        Ok(saved) => created(&saved, &generated.plaintext),
        Err(response) => response,
    }
}

/// `DELETE /api/settings/mcp-tokens?id=`: revoke one of the caller's MCP tokens.
pub async fn mcp_tokens_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    if !state.settings.mcp_enabled {
        return disabled();
    }
    remove_token(&state, &headers, &uri, "mcp-tokens").await
}

/// Deletes the caller's token named by `?id=`; 404 when no such token exists.
async fn remove_token(state: &AppState, headers: &HeaderMap, uri: &Uri, context: &str) -> Response {
    if !has_bearer(headers) {
        return error_response(401, NOT_AUTHENTICATED);
    }
    let Some(id) = query_param(uri, "id") else {
        return error_response(400, "Token id required.");
    };
    let caller = match session(state, headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match user_db(state, &caller)
        .delete_counted("api_tokens", &[("id", eq(&id))])
        .await
    {
        Ok(0) => error_response(404, "Token not found."),
        Ok(_) => json_response(200, &json!({"ok": true})),
        Err(err) => db_failure(&err, context),
    }
}

/// Saves a token row and returns the saved row; a failure comes back as the response to send.
async fn insert_token(
    state: &AppState,
    caller: &Caller,
    row: &Value,
    context: &str,
) -> Result<Value, Response> {
    let query = [("select", TOKEN_COLUMNS.to_string())];
    match user_db(state, caller)
        .insert_returning("api_tokens", row, &query)
        .await
    {
        Ok(rows) => rows
            .into_iter()
            .next()
            .ok_or_else(|| error_response(500, "Token was not saved.")),
        Err(err) => Err(db_failure(&err, context)),
    }
}

/// The reply for a new token: its record and the one-time plaintext.
fn created(row: &Value, plaintext: &str) -> Response {
    json_response(
        200,
        &json!({"record": map_row(row), "plaintext": plaintext}),
    )
}

/// The caller's API tokens as mapped rows, newest first.
async fn list(db: &UserDb<'_>) -> Result<Vec<Value>, DbError> {
    let query = [
        ("select", TOKEN_COLUMNS.to_string()),
        ("order", "created_at.desc".to_string()),
    ];
    let rows = db.select("api_tokens", &query).await?;
    Ok(rows.iter().map(map_row).collect())
}

/// The 404 for MCP routes while MCP is switched off; never cached.
fn disabled() -> Response {
    let mut response = json_response(404, &json!({"error": "mcp_disabled"}));
    let _ = response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// Whether the request carries a non-empty bearer token.
fn has_bearer(headers: &HeaderMap) -> bool {
    bearer_token(
        headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok()),
    )
    .is_some()
}

/// The signed-in session behind the request; a refusal comes back as the response to send.
async fn session(state: &AppState, headers: &HeaderMap) -> Result<Caller, Response> {
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    require_session(&state.client, &state.config, authorization)
        .await
        .map_err(|err| error_response(err.status, &err.message))
}

/// Milliseconds since the Unix epoch.
fn now_ms() -> i64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    i64::try_from(millis).unwrap_or(0)
}

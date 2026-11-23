//! The integration-credentials routes: `/api/settings/credentials`.
//! Ported from apps/web/src/app/api/settings/credentials/{route.ts,_credentials.ts}.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderMap, HeaderValue};
use axum::response::Response;
use serde_json::{Map, Value, json};
use wf_core::sync::instant::format_instant;

use crate::auth::Caller;
use crate::credential_crypto::{open, seal};
use crate::legacy_credentials::{legacy_guard, legacy_secrets, seal_patch};
use crate::postgrest::eq;
use crate::routes::AppState;
use crate::sdk::{db_failure, error_response, json_response, session, user_db};

/// The trimmed secrets and the non-blank integration fields worth storing; everything else is dropped.
#[must_use]
pub fn clean_secrets(input: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(fields) = input.as_object() else {
        return out;
    };
    for key in ["zoteroApiKey", "semanticScholarKey"] {
        let trimmed = fields
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(value) = trimmed {
            let _old = out.insert(key.to_owned(), json!(value));
        }
    }
    if let Some(integrations) = fields.get("integrations").and_then(Value::as_object) {
        let mut kept = Map::new();
        for (provider, provider_fields) in integrations {
            let Some(provider_fields) = provider_fields.as_object() else {
                continue;
            };
            let values: Map<String, Value> = provider_fields
                .iter()
                .filter(|(_, value)| value.as_str().is_some_and(|text| !text.trim().is_empty()))
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect();
            if !values.is_empty() {
                let _old = kept.insert(provider.clone(), Value::Object(values));
            }
        }
        if !kept.is_empty() {
            let _old = out.insert("integrations".to_owned(), Value::Object(kept));
        }
    }
    out
}

/// `GET /api/settings/credentials`: the caller's integration secrets, decrypted when sealed.
pub async fn credentials_get(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let row = match settings_row(&state, &caller).await {
        Ok(row) => row,
        Err(response) => return response,
    };
    // A sealed envelope wins over any legacy plaintext columns.
    let secrets = match sealed_envelope(&row) {
        Some(envelope) => match open_secrets(&envelope, state.settings.credential_key.as_deref()) {
            Ok(secrets) => secrets,
            Err(response) => return response,
        },
        // Legacy plaintext: seal it and clear the columns, then return it. When the row
        // changed meanwhile, the current stored keys are returned instead (cleaned).
        None => match legacy_secrets(&row) {
            Some(secrets) => match seal_on_read(&state, &caller, &row, &secrets).await {
                Ok(stored) => stored,
                Err(response) => return response,
            },
            None => Map::new(),
        },
    };
    no_store(json_response(200, &Value::Object(secrets)))
}

/// The caller's `user_settings` row, or null when there is none.
async fn settings_row(state: &AppState, caller: &Caller) -> Result<Value, Response> {
    let query = [
        (
            "select",
            "credentials_enc,zotero_api_key,semantic_scholar_key,integrations".to_string(),
        ),
        ("user_id", eq(&caller.user_id)),
        ("limit", "1".to_string()),
    ];
    match user_db(state, caller).select("user_settings", &query).await {
        Ok(rows) => Ok(rows.into_iter().next().unwrap_or(Value::Null)),
        Err(err) => Err(db_failure(&err, "credentials")),
    }
}

/// The sealed envelope of a row, when it has a non-empty one.
fn sealed_envelope(row: &Value) -> Option<String> {
    field(row, "credentials_enc")
        .as_str()
        .filter(|envelope| !envelope.is_empty())
        .map(str::to_owned)
}

/// `POST /api/settings/credentials`: seal and store the caller's secrets, clearing legacy columns.
pub async fn credentials_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let parsed = match serde_json::from_slice::<Value>(&body) {
        Ok(parsed) => parsed,
        Err(err) => return error_response(400, &format!("Invalid JSON body: {err}")),
    };
    if !parsed.is_object() {
        return error_response(400, "Body must be a JSON object.");
    }
    let secrets = clean_secrets(&parsed);
    let credentials_enc = if secrets.is_empty() {
        Value::Null
    } else {
        match seal(
            &Value::Object(secrets).to_string(),
            state.settings.credential_key.as_deref(),
        ) {
            Ok(envelope) => Value::String(envelope),
            Err(message) => return error_response(500, &message),
        }
    };
    let row = json!({
        "user_id": caller.user_id,
        "credentials_enc": credentials_enc,
        "zotero_api_key": null,
        "semantic_scholar_key": null,
        "integrations": null,
        "updated_at": format_instant(now_ms()),
    });
    let query = [("on_conflict", "user_id".to_string())];
    let db = user_db(&state, &caller);
    match db.upsert("user_settings", &row, &query).await {
        Ok(_) => no_store(json_response(200, &json!({"ok": true}))),
        Err(err) => db_failure(&err, "settings-credentials"),
    }
}

/// The secrets inside a sealed envelope, or the 500 reply when they cannot be read.
fn open_secrets(envelope: &str, key: Option<&str>) -> Result<Map<String, Value>, Response> {
    let plain = open(envelope, key).map_err(|message| error_response(500, &message))?;
    match serde_json::from_str::<Value>(&plain) {
        Ok(value) => Ok(clean_secrets(&value)),
        Err(_) => Err(error_response(500, "Stored credential is not valid JSON.")),
    }
}

/// Stores `row`'s legacy `secrets` (as stored) sealed and clears the plaintext columns. The
/// write only lands while the row still holds exactly the values read, so a key written
/// since is never overwritten. Returns the cleaned secrets now held: the ones sealed when
/// the write landed, else the row's current state (its envelope or its current plaintext).
/// Fails the read rather than return secrets that were not saved.
async fn seal_on_read(
    state: &AppState,
    caller: &Caller,
    row: &Value,
    secrets: &Map<String, Value>,
) -> Result<Map<String, Value>, Response> {
    let patch = seal_patch(secrets, state.settings.credential_key.as_deref())
        .map_err(|message| error_response(500, &message))?;
    let guard = legacy_guard(&caller.user_id, row);
    let written = user_db(state, caller)
        .update_returning("user_settings", &guard, &patch)
        .await
        .map_err(|err| db_failure(&err, "credentials"))?;
    if !written.is_empty() {
        return Ok(clean_secrets(&Value::Object(secrets.clone())));
    }
    // Lost a race: serve what the row holds now; the next read seals it.
    let current = settings_row(state, caller).await?;
    match sealed_envelope(&current) {
        Some(envelope) => open_secrets(&envelope, state.settings.credential_key.as_deref()),
        None => Ok(legacy_secrets(&current)
            .map(|current| clean_secrets(&Value::Object(current)))
            .unwrap_or_default()),
    }
}

/// A reply that must not be cached, since it carries secrets.
fn no_store(mut response: Response) -> Response {
    let _old = response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// Field `key` of a row; a missing or null field reads as null.
fn field(row: &Value, key: &str) -> Value {
    row.get(key).cloned().unwrap_or(Value::Null)
}

/// The current time in milliseconds since the Unix epoch.
fn now_ms() -> i64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    i64::try_from(millis).unwrap_or(0)
}

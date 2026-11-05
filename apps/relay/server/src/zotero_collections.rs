//! `POST /api/integrations/zotero/collections`: lists a Zotero library's collections for the settings page.
//! The Zotero API key is forwarded to Zotero only and never stored or echoed back.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Value, json};
use wf_core::zotero::normalize_library;

use crate::routes::AppState;
use crate::sdk::{caller, error_response, json_response, no_store};

/// How long Zotero gets to answer before the request is reported as unreachable.
const ZOTERO_TIMEOUT: Duration = Duration::from_secs(10);

/// `POST /api/integrations/zotero/collections`: the `{key, name}` collections of `library`.
pub async fn collections_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(response) = caller(&state, &headers).await {
        return response;
    }
    let parsed = match serde_json::from_slice::<Value>(&body) {
        Ok(parsed) => parsed,
        Err(err) => return error_response(400, &format!("Invalid JSON body: {err}")),
    };
    let api_key = text_field(&parsed, "apiKey").trim();
    let library = normalize_library(parsed.get("library").and_then(Value::as_str));
    let Some(library) = library.filter(|_| !api_key.is_empty()) else {
        return error_response(400, "A valid Zotero library and API key are required.");
    };
    let rows = match fetch_rows(&state, &library, api_key).await {
        Ok(rows) => rows,
        Err(response) => return response,
    };
    let Some(collections) = to_collections(&rows) else {
        return unexpected();
    };
    no_store(json_response(200, &json!({"collections": collections})))
}

/// The string field `key` of the body; "" when missing or not a string.
fn text_field<'a>(body: &'a Value, key: &str) -> &'a str {
    body.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Asks Zotero for the first page of collections; the parsed reply rows, or the error to answer with.
async fn fetch_rows(
    state: &AppState,
    library: &str,
    api_key: &str,
) -> Result<Vec<Value>, Response> {
    let base = state.settings.zotero_api.trim_end_matches('/');
    let url = format!("{base}/{library}/collections?limit=100");
    let sent = state
        .client
        .get(&url)
        .header("Zotero-API-Key", api_key)
        .header("Zotero-API-Version", "3")
        .timeout(ZOTERO_TIMEOUT)
        .send()
        .await;
    let answer = match sent {
        Ok(answer) => answer,
        Err(err) => {
            eprintln!("[zotero-collections] Zotero unreachable: {err}");
            return Err(error_response(502, "Unable to reach Zotero."));
        }
    };
    let status = answer.status();
    if !status.is_success() {
        let code = if status == StatusCode::UNAUTHORIZED {
            401
        } else {
            502
        };
        return Err(error_response(
            code,
            "Zotero rejected the collection request.",
        ));
    }
    let bytes = answer.bytes().await.map_err(|_| unexpected())?;
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Array(rows)) => Ok(rows),
        _ => Err(unexpected()),
    }
}

/// The `{key, name}` of each row that has a key; None when a row is not an object.
fn to_collections(rows: &[Value]) -> Option<Vec<Value>> {
    let mut collections = Vec::new();
    for row in rows {
        let object = row.as_object()?;
        let data = object.get("data");
        let key = data
            .and_then(|data| data.get("key"))
            .and_then(Value::as_str);
        let name = data
            .and_then(|data| data.get("name"))
            .and_then(Value::as_str);
        if let Some(key) = key.filter(|key| !key.is_empty()) {
            collections.push(json!({"key": key, "name": name.unwrap_or("")}));
        }
    }
    Some(collections)
}

/// The 502 for a Zotero reply that is not a list of collection rows.
fn unexpected() -> Response {
    error_response(502, "Zotero sent an unexpected response.")
}

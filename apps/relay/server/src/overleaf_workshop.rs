//! The Overleaf workshop routes (`/api/overleaf/workshop/*`).
//! Ported from apps/web/src/app/api/overleaf/workshop/*/route.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderMap, Uri};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};
use wf_core::overleaf_workshop::{
    WorkshopRequest, read_workshop_request, read_workshop_session_id, safe_overleaf_error,
};

use crate::auth::Caller;
use crate::credential_crypto::{open, seal};
use crate::overleaf_api::{Identity, OverleafApi};
use crate::postgrest::eq;
use crate::routes::AppState;
use crate::sdk::{caller, error_response, json_response, no_store, query_param, user_db};

const TABLE: &str = "overleaf_workshop_sessions";
const COOKIE_REQUIRED: &str = "An Overleaf session cookie is required.";
const NOT_FOUND: &str = "Overleaf session not found. Sign in again.";
const LOGIN_FAILED: &str = "Failed to get User ID.";
const COMPILE_FAILED: &str = "Overleaf compile request failed.";
const SESSION_REQUIRED: &str = "Session id required.";
const SAVE_FAILED: &str = "Could not save the Overleaf session.";
const LOAD_FAILED: &str = "Could not load the Overleaf session.";
const REMOVE_FAILED: &str = "Could not remove the Overleaf session.";
const NO_PDF: &str = "The compile produced no PDF.";
const NOT_DOWNLOADED: &str = "The PDF could not be downloaded.";

/// `POST /api/overleaf/workshop/session`: verify a cookie, store it sealed, return an opaque id.
pub async fn session_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let parsed = match parse_json(&body) {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    let cookies = parsed
        .get("cookies")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    if cookies.is_empty() {
        return error_response(400, COOKIE_REQUIRED);
    }
    let api = match api_client(&state) {
        Ok(api) => api,
        Err(response) => return response,
    };
    match sign_in(&api, &cookies).await {
        Ok(Some(_)) => {}
        Ok(None) => return error_response(401, LOGIN_FAILED),
        Err(response) => return response,
    }
    // Seal before any database call so a missing key writes nothing.
    let envelope = match seal(&cookies, state.settings.credential_key.as_deref()) {
        Ok(envelope) => envelope,
        Err(message) => return safe_failure(&message, Some(&cookies)),
    };
    let row = json!({"user_id": caller.user_id, "cookie_ciphertext": envelope});
    let query = [("select", "id".to_string())];
    let saved = user_db(&state, &caller)
        .insert_returning(TABLE, &row, &query)
        .await
        .ok()
        .and_then(|rows| {
            rows.first()
                .and_then(|saved_row| saved_row.get("id"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
    match saved {
        Some(session_id) => no_store(json_response(201, &json!({"sessionId": session_id}))),
        None => error_response(502, SAVE_FAILED),
    }
}

/// `DELETE /api/overleaf/workshop/session?id=`: forget a stored session.
pub async fn session_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(id) = query_param(&uri, "id") else {
        return error_response(400, SESSION_REQUIRED);
    };
    let query = [("id", eq(&id)), ("user_id", eq(&caller.user_id))];
    match user_db(&state, &caller).delete(TABLE, &query).await {
        Ok(()) => json_response(200, &json!({"ok": true})),
        Err(_) => error_response(502, REMOVE_FAILED),
    }
}

/// `POST /api/overleaf/workshop/projects`: list the caller's Overleaf projects for a session.
pub async fn projects_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let parsed = match parse_json(&body) {
        Ok(parsed) => parsed,
        Err(response) => return response,
    };
    let session_id = match read_workshop_session_id(&parsed) {
        Ok(session_id) => session_id,
        Err(message) => return error_response(400, message),
    };
    let cookies = match load_cookies(&state, &caller, &session_id).await {
        Ok(Some(cookies)) => cookies,
        // `expired` tells the client to forget its stored id.
        Ok(None) => return json_response(401, &json!({"error": NOT_FOUND, "expired": true})),
        Err(response) => return response,
    };
    let api = match api_client(&state) {
        Ok(api) => api,
        Err(response) => return response,
    };
    let identity = match sign_in(&api, &cookies).await {
        Ok(Some(identity)) => identity,
        Ok(None) => return error_response(502, LOGIN_FAILED),
        Err(response) => return response,
    };
    let listed = match api.user_projects(&identity).await {
        Ok(listed) => listed,
        Err(message) => return error_response(502, &message),
    };
    let projects: Vec<Value> = listed
        .iter()
        .map(|project| copy_fields(project, &["id", "name"]))
        .collect();
    no_store(json_response(200, &json!({"projects": projects})))
}

/// `POST /api/overleaf/workshop/compile`: compile an Overleaf project with a stored session.
pub async fn compile_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let request = match parse_request(&body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let cookies = match load_cookies(&state, &caller, &request.session_id).await {
        Ok(Some(cookies)) => cookies,
        Ok(None) => return error_response(401, NOT_FOUND),
        Err(response) => return response,
    };
    match compile_for(&state, &cookies, &request).await {
        Ok((_, _, compiled)) => no_store(json_response(
            200,
            &copy_fields(&compiled, &["status", "outputFiles"]),
        )),
        Err(response) => response,
    }
}

/// `POST /api/overleaf/workshop/pdf`: compile with a stored session and return `output.pdf`.
pub async fn pdf_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let request = match parse_request(&body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let cookies = match load_cookies(&state, &caller, &request.session_id).await {
        Ok(Some(cookies)) => cookies,
        Ok(None) => return error_response(401, NOT_FOUND),
        Err(response) => return response,
    };
    let (api, identity, compiled) = match compile_for(&state, &cookies, &request).await {
        Ok(signed) => signed,
        Err(response) => return response,
    };
    match download_pdf(&api, &identity, &compiled, &cookies).await {
        Ok(pdf) => (
            [
                (CONTENT_TYPE, "application/pdf"),
                (CACHE_CONTROL, "no-store"),
            ],
            pdf,
        )
            .into_response(),
        Err(response) => response,
    }
}

/// Parses a JSON body, or the 400 reply when it is not JSON.
fn parse_json(body: &[u8]) -> Result<Value, Response> {
    serde_json::from_slice::<Value>(body)
        .map_err(|err| error_response(400, &format!("Invalid JSON body: {err}")))
}

/// The compile/pdf body, validated; or the 400 reply.
fn parse_request(body: &[u8]) -> Result<WorkshopRequest, Response> {
    let parsed = parse_json(body)?;
    read_workshop_request(&parsed).map_err(|message| error_response(400, message))
}

/// A 502 reply for a failed Overleaf or sealing step, with the cookie and URLs kept out.
fn safe_failure(message: &str, cookies: Option<&str>) -> Response {
    error_response(502, &safe_overleaf_error(message, cookies))
}

/// The Overleaf client for the configured base; the 502 reply when it cannot be built.
fn api_client(state: &AppState) -> Result<OverleafApi, Response> {
    OverleafApi::new(
        &state.settings.overleaf_base,
        state.settings.overleaf_retry_ms,
    )
    .map_err(|message| safe_failure(&message, None))
}

/// The decrypted cookie of the caller's session `session_id`; `None` when no row matches.
async fn load_cookies(
    state: &AppState,
    caller: &Caller,
    session_id: &str,
) -> Result<Option<String>, Response> {
    let query = [
        ("select", "cookie_ciphertext".to_string()),
        ("id", eq(session_id)),
        ("user_id", eq(&caller.user_id)),
    ];
    let rows = user_db(state, caller)
        .select(TABLE, &query)
        .await
        .map_err(|_| error_response(502, LOAD_FAILED))?;
    let Some(envelope) = rows
        .first()
        .and_then(|row| row.get("cookie_ciphertext"))
        .and_then(Value::as_str)
    else {
        return Ok(None);
    };
    open(envelope, state.settings.credential_key.as_deref())
        .map(Some)
        .map_err(|message| safe_failure(&message, None))
}

/// Signs in with `cookies`: the identity, `None` when Overleaf refuses them, or the 502 reply.
async fn sign_in(api: &OverleafApi, cookies: &str) -> Result<Option<Identity>, Response> {
    api.cookies_login(cookies)
        .await
        .map_err(|message| safe_failure(&message, Some(cookies)))
}

/// Signs in and compiles; the client, the identity and the compile object, or the reply to send.
async fn compile_for(
    state: &AppState,
    cookies: &str,
    request: &WorkshopRequest,
) -> Result<(OverleafApi, Identity, Value), Response> {
    let api = api_client(state)?;
    let Some(identity) = sign_in(&api, cookies).await? else {
        return Err(safe_failure(LOGIN_FAILED, Some(cookies)));
    };
    let compiled = api
        .compile(
            &identity,
            &request.project_id,
            request.root_resource_path.as_deref(),
        )
        .await
        .map_err(|message| safe_failure(&message, Some(cookies)))?;
    if !compiled.is_object() {
        return Err(safe_failure(COMPILE_FAILED, Some(cookies)));
    }
    Ok((api, identity, compiled))
}

/// The `output.pdf` bytes of a finished compile, or the 502 reply that says why not.
async fn download_pdf(
    api: &OverleafApi,
    identity: &Identity,
    compiled: &Value,
    cookies: &str,
) -> Result<Vec<u8>, Response> {
    if compiled.get("status").and_then(Value::as_str) != Some("success") {
        let status = compile_status(compiled);
        let message = format!("Compile failed (status {status}).");
        return Err(safe_failure(&message, Some(cookies)));
    }
    let Some(entry) = output_pdf(compiled) else {
        return Err(error_response(502, NO_PDF));
    };
    let url = entry.get("url").and_then(Value::as_str).unwrap_or("");
    let group = compiled
        .get("compileGroup")
        .and_then(Value::as_str)
        .unwrap_or("undefined");
    let server = compiled.get("clsiServerId").and_then(Value::as_str);
    let domain = compiled.get("pdfDownloadDomain").and_then(Value::as_str);
    let pdf = api
        .get_file_from_clsi(identity, url, group, server, domain)
        .await
        .map_err(|message| safe_failure(&message, Some(cookies)))?;
    if pdf.is_empty() {
        return Err(error_response(502, NOT_DOWNLOADED));
    }
    Ok(pdf)
}

/// The compile status as the TS message shows it: the string, its JSON text, or "undefined".
fn compile_status(compiled: &Value) -> String {
    match compiled.get("status") {
        Some(Value::String(status)) => status.clone(),
        Some(other) => other.to_string(),
        None => "undefined".to_string(),
    }
}

/// The `output.pdf` entry of a compile's `outputFiles`, when there is one.
fn output_pdf(compiled: &Value) -> Option<&Value> {
    compiled
        .get("outputFiles")?
        .as_array()?
        .iter()
        .find(|file| file.get("path").and_then(Value::as_str) == Some("output.pdf"))
}

/// The keys of `source` that are present, copied into a new object.
fn copy_fields(source: &Value, keys: &[&str]) -> Value {
    let mut out = Map::new();
    for key in keys {
        if let Some(value) = source.get(*key) {
            let _previous = out.insert((*key).to_owned(), value.clone());
        }
    }
    Value::Object(out)
}

//! `POST /api/sdk/artifacts`: an experiment artifact uploaded by the Python SDK.
//! Ported from apps/web/src/app/api/sdk/artifacts/{route.ts,artifact-request.ts}.

use std::sync::Arc;

use axum::body::to_bytes;
use axum::extract::{Request, State};
use axum::http::HeaderMap;
use axum::http::header::CONTENT_LENGTH;
use axum::response::Response;
use base64::Engine as _;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use serde_json::{Map, Value, json};
use wf_core::storage::blob_access::{MAX_BLOB_BYTES, base64_byte_length, is_safe_segment};

use crate::routes::AppState;
use crate::safe_error::SERVER_FAULT;
use crate::sdk::{error_response, json_response, parse_body};

/// Largest JSON body: base64 of the blob limit plus a margin (`MAX_BODY_BYTES` in TS).
pub const ARTIFACT_BODY_LIMIT: usize = 34_956_630;

const CONTENT_TYPE_DEFAULT: &str = "application/octet-stream";
const MISSING: &str = "Body must include experimentId, name, dataBase64.";
const BAD_EXPERIMENT_ID: &str = "experimentId must be a plain identifier with no path separators.";
const BAD_NAME: &str = "name must be 1-128 characters of letters, digits, dot, dash or underscore, with no path separators.";
const DATA_NOT_STRING: &str = "dataBase64 must be a string.";
const DECODED_EMPTY: &str = "dataBase64 decoded to no bytes.";
const TOO_LARGE_REQUEST: &str = "Request body exceeds 33 MB.";
const TOO_LARGE_ARTIFACT: &str = "Artifact exceeds the 25 MB limit.";
const BAD_JSON: &str = "Invalid JSON body.";

/// A validated upload: the path segments, the content type and the decoded bytes.
struct Artifact {
    experiment_id: String,
    name: String,
    content_type: String,
    bytes: Vec<u8>,
}

/// `POST /api/sdk/artifacts`: store the artifact under the caller's folder and answer its path.
pub async fn artifacts_post(State(state): State<Arc<AppState>>, request: Request) -> Response {
    let who = match crate::sdk::caller(&state, request.headers()).await {
        Ok(who) => who,
        Err(response) => return response,
    };
    // Before buffering, so an oversized body is refused on its declared length.
    if exceeds_declared_limit(request.headers()) {
        return error_response(413, TOO_LARGE_REQUEST);
    }
    let Ok(bytes) = to_bytes(request.into_body(), ARTIFACT_BODY_LIMIT).await else {
        return error_response(413, TOO_LARGE_REQUEST);
    };
    let fields = match parse_body(&bytes) {
        Some(Value::Object(fields)) => fields,
        // An array counts as an object with no keys, as in the Next route.
        Some(_) => Map::new(),
        None => return error_response(400, BAD_JSON),
    };
    let artifact = match parse_artifact(&fields) {
        Ok(artifact) => artifact,
        Err((status, message)) => return error_response(status, message),
    };
    let path = format!(
        "{}/{}/{}",
        who.user_id, artifact.experiment_id, artifact.name
    );
    let stored = store(
        &state,
        &who.access_token,
        &path,
        &artifact.content_type,
        artifact.bytes,
    )
    .await;
    if !stored {
        return error_response(500, SERVER_FAULT);
    }
    // A path has no expiry; the reader mints a short-lived URL when it needs one.
    json_response(200, &json!({"path": path, "url": path}))
}

/// Whether the declared `Content-Length` is already over the body limit.
fn exceeds_declared_limit(headers: &HeaderMap) -> bool {
    let limit = u64::try_from(ARTIFACT_BODY_LIMIT).unwrap_or(u64::MAX);
    headers
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|declared| declared > limit)
}

/// Checks the fields in the TS order; the status and message of the first refusal.
fn parse_artifact(fields: &Map<String, Value>) -> Result<Artifact, (u16, &'static str)> {
    if is_missing(fields.get("experimentId"))
        || is_missing(fields.get("name"))
        || is_missing(fields.get("dataBase64"))
    {
        return Err((400, MISSING));
    }
    let experiment_id = match fields.get("experimentId").and_then(Value::as_str) {
        Some(id) if is_safe_segment(id) => id.to_owned(),
        _ => return Err((400, BAD_EXPERIMENT_ID)),
    };
    let name = match fields.get("name").and_then(Value::as_str) {
        Some(name) if is_safe_segment(name) => name.to_owned(),
        _ => return Err((400, BAD_NAME)),
    };
    let Some(data) = fields.get("dataBase64").and_then(Value::as_str) else {
        return Err((400, DATA_NOT_STRING));
    };
    if base64_byte_length(data) > MAX_BLOB_BYTES {
        return Err((413, TOO_LARGE_ARTIFACT));
    }
    let bytes = decode_base64(data).ok_or((400, "dataBase64 must be valid base64."))?;
    // Re-checked after decoding: the estimate above assumes well-formed base64.
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_BLOB_BYTES {
        return Err((413, TOO_LARGE_ARTIFACT));
    }
    if bytes.is_empty() {
        return Err((400, DECODED_EMPTY));
    }
    Ok(Artifact {
        experiment_id,
        name,
        content_type: content_type(fields),
        bytes,
    })
}

/// JS truthiness for a JSON field: absent, null, false, 0 and "" all count as missing.
fn is_missing(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => true,
        Some(Value::Bool(flag)) => !flag,
        Some(Value::Number(number)) => number.as_f64() == Some(0.0),
        Some(Value::String(text)) => text.is_empty(),
        Some(_) => false,
    }
}

/// The `contentType` field when it is a non-blank string, else the default type.
fn content_type(fields: &Map<String, Value>) -> String {
    match fields.get("contentType").and_then(Value::as_str) {
        Some(content_type) if !content_type.trim().is_empty() => content_type.to_owned(),
        _ => CONTENT_TYPE_DEFAULT.to_owned(),
    }
}

/// Decodes base64 the way Node's `Buffer.from(s, "base64")` does: stops at `=`,
/// skips characters outside the alphabet, and accepts the URL-safe alphabet too.
fn decode_base64(data: &str) -> Option<Vec<u8>> {
    let mut clean: String = data
        .chars()
        .take_while(|c| *c != '=')
        .filter_map(|c| match c {
            '-' => Some('+'),
            '_' => Some('/'),
            c if c.is_ascii_alphanumeric() || c == '+' || c == '/' => Some(c),
            _ => None,
        })
        .collect();
    // A lone trailing character carries no whole byte; Node drops it.
    if clean.len() % 4 == 1 {
        let _ = clean.pop();
    }
    let engine = GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        GeneralPurposeConfig::new()
            .with_decode_padding_mode(DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    );
    engine.decode(clean).ok()
}

/// Writes the bytes to the caller's own folder as the caller; `false` when storage refused.
async fn store(
    state: &AppState,
    access_token: &str,
    path: &str,
    content_type: &str,
    bytes: Vec<u8>,
) -> bool {
    let reply = state
        .client
        .post(format!(
            "{}/storage/v1/object/experiment-artifacts/{path}",
            state.config.supabase_url
        ))
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {access_token}"),
        )
        .header("apikey", state.config.anon_key.as_str())
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .header("x-upsert", "true")
        .body(bytes)
        .send()
        .await;
    let response = match reply {
        Ok(response) => response,
        Err(err) => {
            eprintln!("[sdk-artifacts] upload failed: {err}");
            return false;
        }
    };
    let status = response.status();
    if status.is_success() {
        return true;
    }
    let text = response.text().await.unwrap_or_default();
    eprintln!("[sdk-artifacts] upload failed: {} {text}", status.as_u16());
    false
}

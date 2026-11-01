//! The tiered-blob routes: content read, remove, signed URLs and upload.
//! Ported from apps/web/src/app/api/blobs/{content,remove,signed-urls,upload}/route.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::multipart::MultipartError;
use axum::extract::{FromRequest, Multipart, Request, State};
use axum::http::header::{CONTENT_LENGTH, HOST};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};

use wf_core::storage::blob_access::{
    MAX_BLOB_BYTES, MAX_SIGNED_URL_PATHS, blob_cache_control, check_allowed_bucket,
    check_path_owned, clamp_ttl_seconds,
};

use crate::auth::Caller;
use crate::blob_store::{self, BlobError, now_seconds, record_access_many, registry_tiers};
use crate::blob_token::{self, BlobViewPayload, MISSING_SECRET};
use crate::routes::AppState;
use crate::s3::S3Object;
use crate::safe_error::format_error_for_response;
use crate::sdk::{caller as authenticate, error_response, json_response, query_param, user_db};

/// The largest upload body the route accepts: the blob cap plus multipart framing.
pub const UPLOAD_BODY_LIMIT: usize = 25 * 1024 * 1024 + 64 * 1024;

/// `GET /api/blobs/content?t=`: stream one blob named by a signed view token.
pub async fn content(State(state): State<Arc<AppState>>, uri: Uri) -> Response {
    if let Some(refusal) = provider_refusal(&state) {
        return refusal;
    }
    let Some(token) = query_param(&uri, "t") else {
        return error_response(400, "Missing token.");
    };
    let Some(secret) = state.storage.view_secret.as_deref() else {
        return error_response(503, MISSING_SECRET);
    };
    let now = now_seconds();
    let Some(payload) = blob_token::verify(&token, secret, now) else {
        return error_response(401, "Invalid or expired token.");
    };
    match blob_store::viewer_tier(&state, &payload.bucket, &payload.path, &payload.uid).await {
        Ok(Some(tier)) => serve_blob(&state, &payload, &tier, now).await,
        Ok(None) => error_response(404, "Not found."),
        Err(err) => error_response(502, &format_error_for_response(&err, "blobs")),
    }
}

/// `POST /api/blobs/remove`: delete one of the caller's blobs.
pub async fn remove(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Some(refusal) = provider_refusal(&state) {
        return refusal;
    }
    let caller = match authenticate(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match json_object(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let (Some(bucket), Some(path)) = (non_empty(&fields, "bucket"), non_empty(&fields, "path"))
    else {
        return error_response(400, "bucket and path are required.");
    };
    match remove_blob(&state, &caller, bucket, path).await {
        Ok(()) => json_response(200, &json!({"ok": true})),
        Err(err) => blob_error_response(&err),
    }
}

/// `POST /api/blobs/signed-urls`: mint content URLs for a batch of the caller's blobs.
pub async fn signed_urls(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Some(refusal) = provider_refusal(&state) {
        return refusal;
    }
    let caller = match authenticate(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match json_object(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let (Some(bucket), Some(paths)) = (
        non_empty(&fields, "bucket"),
        fields.get("paths").and_then(Value::as_array),
    ) else {
        return error_response(400, "bucket and paths are required.");
    };
    if paths.len() > MAX_SIGNED_URL_PATHS {
        let message = format!("At most {MAX_SIGNED_URL_PATHS} paths per request.");
        return error_response(400, &message);
    }
    let ttl = clamp_ttl_seconds(fields.get("ttlSeconds").and_then(Value::as_f64));
    let Some(origin) = origin_from(&headers) else {
        return error_response(400, "Missing host.");
    };
    match mint_urls(&state, &caller, bucket, paths, ttl, &origin).await {
        Ok(urls) => json_response(200, &json!({"urls": urls})),
        Err(err) => blob_error_response(&err),
    }
}

/// `POST /api/blobs/upload`: store one multipart blob for the caller.
pub async fn upload(State(state): State<Arc<AppState>>, request: Request) -> Response {
    if let Some(refusal) = provider_refusal(&state) {
        return refusal;
    }
    let headers = request.headers().clone();
    if declared_too_large(&headers) {
        return too_large();
    }
    let caller = match authenticate(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let mut multipart = match Multipart::from_request(request, &()).await {
        Ok(multipart) => multipart,
        Err(_) => return error_response(400, "Expected multipart form."),
    };
    let form = match read_form(&mut multipart).await {
        Ok(form) => form,
        Err(response) => return response,
    };
    let UploadForm {
        bucket,
        path,
        content_type,
        file,
    } = form;
    let Some((part_type, bytes)) = file.filter(|_| !bucket.is_empty() && !path.is_empty()) else {
        return error_response(400, "bucket, path, and file are required.");
    };
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_BLOB_BYTES {
        return too_large();
    }
    let content_type = content_type
        .or(part_type)
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    match store_upload(&state, &caller, &bucket, &path, bytes, &content_type).await {
        Ok(()) => json_response(200, &json!({"ok": true})),
        Err(err) => blob_error_response(&err),
    }
}

/// The parts of an upload form the route reads; `file` holds the part's type and bytes.
#[derive(Default)]
struct UploadForm {
    bucket: String,
    path: String,
    content_type: Option<String>,
    file: Option<(Option<String>, Vec<u8>)>,
}

/// Refusal when this deployment does not run the tiered store, or `None` when it does.
fn provider_refusal(state: &AppState) -> Option<Response> {
    if state.storage.tiered {
        None
    } else {
        Some(error_response(503, "BLOB_PROVIDER is not tiered."))
    }
}

/// The JSON body as an object; anything else is a bad request.
fn json_object(body: &[u8]) -> Result<Map<String, Value>, Response> {
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(fields)) => Ok(fields),
        _ => Err(error_response(400, "Invalid JSON body.")),
    }
}

/// Field `key` as text, or `None` when it is missing, not text, or empty.
fn non_empty<'a>(fields: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    fields
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// The 413 reply for a blob or body over the size cap.
fn too_large() -> Response {
    error_response(413, "Blob exceeds the 25 MB limit.")
}

/// True when the declared `content-length` is over the upload body limit.
fn declared_too_large(headers: &HeaderMap) -> bool {
    let declared = headers
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    declared.is_some_and(|len| len > u64::try_from(UPLOAD_BODY_LIMIT).unwrap_or(u64::MAX))
}

/// The reply for a blob failure: its status and its message.
fn blob_error_response(err: &BlobError) -> Response {
    error_response(err.status(), &err.message())
}

/// The origin the caller reached us at, from the forwarded or plain host headers.
fn origin_from(headers: &HeaderMap) -> Option<String> {
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https");
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(HOST))
        .and_then(|value| value.to_str().ok())?;
    Some(format!("{proto}://{host}"))
}

/// A multipart read failure: 413 when the body was too large, else 400.
fn form_error(err: &MultipartError) -> Response {
    if err.status() == StatusCode::PAYLOAD_TOO_LARGE {
        too_large()
    } else {
        error_response(400, "Expected multipart form.")
    }
}

/// Read every field of the multipart form into an `UploadForm`.
async fn read_form(multipart: &mut Multipart) -> Result<UploadForm, Response> {
    let mut form = UploadForm::default();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| form_error(&err))?
    {
        let name = field.name().unwrap_or_default().to_owned();
        let part_type = field.content_type().map(str::to_owned);
        match name.as_str() {
            "file" => {
                let bytes = field.bytes().await.map_err(|err| form_error(&err))?;
                form.file = Some((part_type, bytes.to_vec()));
            }
            "bucket" | "path" | "contentType" => {
                let text = field.text().await.map_err(|err| form_error(&err))?;
                match name.as_str() {
                    "bucket" => form.bucket = text,
                    "path" => form.path = text,
                    _ => form.content_type = Some(text),
                }
            }
            _ => {}
        }
    }
    Ok(form)
}

/// Serve the bytes of a verified view token with the blob's headers.
async fn serve_blob(state: &AppState, payload: &BlobViewPayload, tier: &str, now: u64) -> Response {
    match blob_store::read(state, &payload.bucket, &payload.path, tier).await {
        Ok(Some(object)) => blob_response(object, payload.exp, now),
        Ok(None) => error_response(404, "Not found."),
        Err(err) => blob_error_response(&err),
    }
}

/// The 200 reply carrying a blob; sandboxed so an uploaded SVG or HTML cannot run script.
fn blob_response(object: S3Object, exp: u64, now: u64) -> Response {
    (
        StatusCode::OK,
        [
            ("content-type", object.content_type),
            ("cache-control", blob_cache_control(exp, now)),
            (
                "content-security-policy",
                "default-src 'none'; sandbox".to_owned(),
            ),
            ("x-content-type-options", "nosniff".to_owned()),
        ],
        object.bytes,
    )
        .into_response()
}

/// Delete one blob after the bucket and path checks.
async fn remove_blob(
    state: &AppState,
    caller: &Caller,
    bucket: &str,
    path: &str,
) -> Result<(), BlobError> {
    check_allowed_bucket(bucket)?;
    check_path_owned(path, &caller.user_id)?;
    let db = user_db(state, caller);
    blob_store::remove(state, &db, bucket, path).await
}

/// Store one uploaded blob after the bucket and path checks.
async fn store_upload(
    state: &AppState,
    caller: &Caller,
    bucket: &str,
    path: &str,
    bytes: Vec<u8>,
    content_type: &str,
) -> Result<(), BlobError> {
    check_allowed_bucket(bucket)?;
    check_path_owned(path, &caller.user_id)?;
    let db = user_db(state, caller);
    blob_store::upload(state, &db, bucket, path, bytes, content_type).await
}

/// Signed URL per requested path, `null` where the blob is unknown; records the access.
async fn mint_urls(
    state: &AppState,
    caller: &Caller,
    bucket: &str,
    paths: &[Value],
    ttl: u64,
    origin: &str,
) -> Result<Vec<Value>, BlobError> {
    let db = user_db(state, caller);
    let wanted: Vec<String> = paths
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    let tiers = registry_tiers(&db, bucket, &wanted).await?;
    let now = now_seconds();
    let mut urls = Vec::with_capacity(paths.len());
    let mut minted = Vec::new();
    for entry in paths {
        let found = entry
            .as_str()
            .and_then(|path| tiers.get(path).map(|tier| (path, tier)));
        let Some((path, tier)) = found else {
            urls.push(Value::Null);
            continue;
        };
        let secret = state
            .storage
            .view_secret
            .as_deref()
            .ok_or_else(|| BlobError::Status(500, MISSING_SECRET.to_owned()))?;
        let url = blob_token::content_url(
            origin,
            &caller.user_id,
            bucket,
            path,
            tier,
            ttl,
            secret,
            now,
        );
        urls.push(Value::String(url));
        minted.push(path.to_owned());
    }
    record_access_many(&db, bucket, &minted).await;
    Ok(urls)
}

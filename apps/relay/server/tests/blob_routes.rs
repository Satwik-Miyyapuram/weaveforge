//! Blob routes (content, remove, signed URLs, upload) over the HTTP router.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::blob_token::{BlobViewPayload, MISSING_SECRET, mint};
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::s3::S3Target;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const BLOBS: &str = "/rest/v1/blob_objects";
const RPC_ACCESS: &str = "/rest/v1/rpc/record_blob_access_many";
const OBJECT: &str = "/phys/paper-images/user-1/a.png";
const EXP_FAR: u64 = 4_102_444_800;
const BOUNDARY: &str = "XyZ";
const NOT_TIERED: &str = "BLOB_PROVIDER is not tiered.";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

fn empty_reply(status: u16) -> Reply {
    response(status, &[], b"")
}

/// An upstream where `a.b.c` is user `user-1`. The given routes win over the default.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]));
    serve(routes).await
}

/// Tiered storage whose hot tier is the upstream itself, bucket `phys`.
fn storage(up: &Upstream) -> StorageConfig {
    StorageConfig {
        tiered: true,
        hot: Ok(S3Target {
            endpoint: format!("http://127.0.0.1:{}", up.port),
            region: "auto".to_string(),
            bucket: "phys".to_string(),
            access_key_id: "AK".to_string(),
            secret_access_key: "SK".to_string(),
        }),
        cold: None,
        view_secret: Some("s".to_string()),
    }
}

fn state(up: &Upstream, storage: StorageConfig) -> Arc<AppState> {
    let supabase = format!("http://127.0.0.1:{}", up.port);
    Arc::new(AppState {
        config: Config {
            data_url: format!("{supabase}/rest/v1"),
            supabase_url: supabase,
            anon_key: "anon".to_string(),
            service_role_key: "service".to_string(),
            jwt_secret: Some("secret".to_string()),
            allowed_origins: Vec::new(),
            bind: "127.0.0.1:0".parse().expect("addr"),
        },
        client: reqwest::Client::new(),
        relay: RelayConfig::production(),
        upstreams: MetaUpstreams::production(),
        pages: RateLimiter::new(PAGE_FETCH_LIMIT),
        pastes: RateLimiter::new(PASTE_FETCH_LIMIT),
        storage,
    })
}

/// A request with the session header and extra headers.
fn request_with(method: &str, uri: &str, body: &str, extra: &[(&str, &str)]) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", SESSION);
    for (name, value) in extra {
        builder = builder.header(*name, *value);
    }
    builder.body(Body::from(body.to_owned())).expect("request")
}

/// A request with the session header.
fn request(method: &str, uri: &str, body: &str) -> Request<Body> {
    request_with(method, uri, body, &[])
}

fn content_request(query: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(format!("/api/blobs/content{query}"))
        .body(Body::empty())
        .expect("request")
}

/// Sends `req` through the router with `storage`; returns status, headers and raw body.
async fn reply(
    up: &Upstream,
    storage: StorageConfig,
    req: Request<Body>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let response = app(state(up, storage))
        .oneshot(req)
        .await
        .expect("router is infallible");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    (status, headers, bytes.to_vec())
}

/// Sends `req` with tiered storage; returns status and the JSON body.
async fn send(up: &Upstream, req: Request<Body>) -> (StatusCode, Value) {
    let (status, _, bytes) = reply(up, storage(up), req).await;
    (status, serde_json::from_slice(&bytes).expect("json body"))
}

/// The requests the upstream saw whose target starts with `prefix`, in order.
fn calls(up: &Upstream, prefix: &str) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target.starts_with(prefix))
        .collect()
}

fn body_json(seen: &Seen) -> Value {
    serde_json::from_slice(&seen.body).expect("json body")
}

fn header(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .expect("header")
        .to_str()
        .expect("ascii")
        .to_string()
}

/// A view token for `path` owned by `user-1`, valid until `exp`.
fn token(path: &str, exp: u64) -> String {
    let payload = BlobViewPayload {
        uid: "user-1".to_string(),
        bucket: "paper-images".to_string(),
        path: path.to_string(),
        tier: "hot".to_string(),
        exp,
    };
    mint(&payload, "s")
}

/// One text field of a multipart body.
fn text_part(name: &str, value: &str) -> String {
    format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
}

/// The `file` part of a multipart body, a PNG named `a.png`.
fn file_part(data: &str) -> String {
    format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\nContent-Type: image/png\r\n\r\n{data}\r\n"
    )
}

/// Joins `parts` and closes the body with the final boundary.
fn multipart(parts: &[String]) -> String {
    format!("{}--{BOUNDARY}--\r\n", parts.concat())
}

fn upload_request(body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/blobs/upload")
        .header("authorization", SESSION)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body.to_owned()))
        .expect("request")
}

#[tokio::test]
async fn every_blob_route_refuses_when_storage_is_not_tiered() {
    let up = upstream(vec![]).await;
    let off = StorageConfig {
        tiered: false,
        ..storage(&up)
    };
    let requests = [
        content_request(""),
        request(
            "POST",
            "/api/blobs/remove",
            r#"{"bucket":"paper-images","path":"user-1/a.png"}"#,
        ),
        request(
            "POST",
            "/api/blobs/signed-urls",
            r#"{"bucket":"paper-images","paths":[]}"#,
        ),
        upload_request(""),
    ];
    for req in requests {
        let (status, _, bytes) = reply(&up, off.clone(), req).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        let value: Value = serde_json::from_slice(&bytes).expect("json body");
        assert_eq!(value, json!({"error": NOT_TIERED}));
    }
}

#[tokio::test]
async fn content_refuses_a_missing_secret_or_a_bad_token() {
    let up = upstream(vec![]).await;
    let (status, _, bytes) = reply(&up, storage(&up), content_request("")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).expect("json"),
        json!({"error": "Missing token."})
    );

    let no_secret = StorageConfig {
        view_secret: None,
        ..storage(&up)
    };
    let (status, _, bytes) = reply(&up, no_secret, content_request("?t=garbage")).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).expect("json"),
        json!({"error": MISSING_SECRET})
    );

    let (status, _, bytes) = reply(&up, storage(&up), content_request("?t=garbage")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).expect("json"),
        json!({"error": "Invalid or expired token."})
    );
}

#[tokio::test]
async fn content_is_not_found_without_a_registry_row() {
    let up = upstream(vec![(BLOBS, vec![json_reply(200, "[]")])]).await;
    let uri = format!("?t={}", token("user-1/a.png", EXP_FAR));
    let (status, _, bytes) = reply(&up, storage(&up), content_request(&uri)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).expect("json"),
        json!({"error": "Not found."})
    );
}

#[tokio::test]
async fn content_serves_the_owners_object_with_view_headers() {
    let up = upstream(vec![
        (
            BLOBS,
            vec![json_reply(200, r#"[{"user_id":"user-1","tier":"hot"}]"#)],
        ),
        (
            OBJECT,
            vec![response(200, &[("Content-Type", "image/png")], b"PNGDATA")],
        ),
    ])
    .await;
    let uri = format!("?t={}", token("user-1/a.png", EXP_FAR));
    let (status, headers, bytes) = reply(&up, storage(&up), content_request(&uri)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, b"PNGDATA".to_vec());
    assert_eq!(header(&headers, "content-type"), "image/png");
    assert!(header(&headers, "cache-control").starts_with("private, max-age="));
    assert_eq!(
        header(&headers, "content-security-policy"),
        "default-src 'none'; sandbox"
    );
    assert_eq!(header(&headers, "x-content-type-options"), "nosniff");
}

#[tokio::test]
async fn content_is_not_found_when_the_object_is_missing() {
    let up = upstream(vec![
        (
            BLOBS,
            vec![json_reply(200, r#"[{"user_id":"user-1","tier":"hot"}]"#)],
        ),
        (OBJECT, vec![empty_reply(404)]),
    ])
    .await;
    let uri = format!("?t={}", token("user-1/a.png", EXP_FAR));
    let (status, _, bytes) = reply(&up, storage(&up), content_request(&uri)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).expect("json"),
        json!({"error": "Not found."})
    );
}

#[tokio::test]
async fn content_reports_a_registry_fault_as_bad_gateway() {
    let up = upstream(vec![(
        BLOBS,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    let uri = format!("?t={}", token("user-1/a.png", EXP_FAR));
    let (status, _, _) = reply(&up, storage(&up), content_request(&uri)).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn remove_refuses_bad_requests_before_touching_storage() {
    let up = upstream(vec![]).await;
    let anonymous = Request::builder()
        .method("POST")
        .uri("/api/blobs/remove")
        .body(Body::from("{}"))
        .expect("request");
    let (status, value) = send(&up, anonymous).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(value, json!({"error": "Not authenticated."}));

    let cases = [
        ("not json", StatusCode::BAD_REQUEST, "Invalid JSON body."),
        (
            r#"{"bucket":"paper-images"}"#,
            StatusCode::BAD_REQUEST,
            "bucket and path are required.",
        ),
        (
            r#"{"bucket":"x","path":"user-1/a"}"#,
            StatusCode::BAD_REQUEST,
            "Unsupported blob bucket.",
        ),
        (
            r#"{"bucket":"paper-images","path":"user-2/a"}"#,
            StatusCode::FORBIDDEN,
            "Forbidden blob path.",
        ),
        (
            r#"{"bucket":"paper-images","path":"user-1/../a"}"#,
            StatusCode::BAD_REQUEST,
            "Invalid blob path.",
        ),
    ];
    for (body, code, message) in cases {
        let (status, value) = send(&up, request("POST", "/api/blobs/remove", body)).await;
        assert_eq!(status, code, "{body}");
        assert_eq!(value, json!({"error": message}), "{body}");
    }
    assert!(calls(&up, "/phys").is_empty());
    assert!(calls(&up, BLOBS).is_empty());
}

#[tokio::test]
async fn remove_deletes_the_object_and_its_registry_row() {
    let up = upstream(vec![
        (
            BLOBS,
            vec![json_reply(200, r#"[{"tier":"hot"}]"#), empty_reply(204)],
        ),
        (OBJECT, vec![empty_reply(204)]),
    ])
    .await;
    let body = r#"{"bucket":"paper-images","path":"user-1/a.png"}"#;
    let (status, value) = send(&up, request("POST", "/api/blobs/remove", body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));
    let object_deletes = calls(&up, OBJECT)
        .into_iter()
        .filter(|seen| seen.method == "DELETE")
        .count();
    assert_eq!(object_deletes, 1);
    let row_deletes = calls(&up, BLOBS)
        .into_iter()
        .filter(|seen| seen.method == "DELETE")
        .count();
    assert_eq!(row_deletes, 1);
}

#[tokio::test]
async fn signed_urls_need_bucket_and_paths() {
    let up = upstream(vec![]).await;
    let body = r#"{"bucket":"paper-images"}"#;
    let (status, value) = send(&up, request("POST", "/api/blobs/signed-urls", body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "bucket and paths are required."}));
}

#[tokio::test]
async fn signed_urls_cap_the_path_count_at_200() {
    let up = upstream(vec![]).await;
    let paths: Vec<String> = (0..201).map(|i| format!("user-1/{i}.png")).collect();
    let body = json!({"bucket": "paper-images", "paths": paths}).to_string();
    let (status, value) = send(&up, request("POST", "/api/blobs/signed-urls", &body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "At most 200 paths per request."}));
}

#[tokio::test]
async fn signed_urls_link_registered_paths_and_record_access() {
    let up = upstream(vec![
        (
            BLOBS,
            vec![json_reply(200, r#"[{"path":"user-1/a.png","tier":"hot"}]"#)],
        ),
        (RPC_ACCESS, vec![json_reply(200, "null")]),
    ])
    .await;
    let body = r#"{"bucket":"paper-images","paths":["user-1/a.png","user-1/missing.png"]}"#;
    let req = request_with(
        "POST",
        "/api/blobs/signed-urls",
        body,
        &[("host", "relay.test")],
    );
    let (status, value) = send(&up, req).await;
    assert_eq!(status, StatusCode::OK);
    let first = value["urls"][0].as_str().expect("url");
    assert!(first.starts_with("https://relay.test/api/blobs/content?t="));
    assert!(value["urls"][1].is_null());
    let access = calls(&up, RPC_ACCESS);
    assert_eq!(access.len(), 1);
    let sent = body_json(access.first().expect("rpc"));
    assert_eq!(sent["p_paths"], json!(["user-1/a.png"]));
}

#[tokio::test]
async fn signed_urls_follow_the_forwarded_proto() {
    let up = upstream(vec![
        (
            BLOBS,
            vec![json_reply(200, r#"[{"path":"user-1/a.png","tier":"hot"}]"#)],
        ),
        (RPC_ACCESS, vec![json_reply(200, "null")]),
    ])
    .await;
    let body = r#"{"bucket":"paper-images","paths":["user-1/a.png"]}"#;
    let req = request_with(
        "POST",
        "/api/blobs/signed-urls",
        body,
        &[("host", "relay.test"), ("x-forwarded-proto", "http")],
    );
    let (status, value) = send(&up, req).await;
    assert_eq!(status, StatusCode::OK);
    let first = value["urls"][0].as_str().expect("url");
    assert!(first.starts_with("http://relay.test/api/blobs/content?t="));
}

#[tokio::test]
async fn upload_refuses_a_declared_body_over_the_limit() {
    let up = upstream(vec![]).await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/blobs/upload")
        .header("authorization", SESSION)
        .header("content-length", "99999999")
        .body(Body::empty())
        .expect("request");
    let (status, value) = send(&up, req).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(value, json!({"error": "Blob exceeds the 25 MB limit."}));
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn upload_refuses_anonymous_and_non_multipart_requests() {
    let up = upstream(vec![]).await;
    let anonymous = Request::builder()
        .method("POST")
        .uri("/api/blobs/upload")
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(multipart(&[file_part("PNGDATA")])))
        .expect("request");
    let (status, value) = send(&up, anonymous).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(value, json!({"error": "Not authenticated."}));

    let json_body = Request::builder()
        .method("POST")
        .uri("/api/blobs/upload")
        .header("authorization", SESSION)
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .expect("request");
    let (status, value) = send(&up, json_body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Expected multipart form."}));
}

#[tokio::test]
async fn upload_needs_a_file_part() {
    let up = upstream(vec![]).await;
    let body = multipart(&[
        text_part("bucket", "paper-images"),
        text_part("path", "user-1/a.png"),
        text_part("contentType", "image/png"),
    ]);
    let (status, value) = send(&up, upload_request(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "bucket, path, and file are required."})
    );
}

#[tokio::test]
async fn upload_puts_the_object_and_registers_it() {
    let up = upstream(vec![
        (OBJECT, vec![empty_reply(200)]),
        (BLOBS, vec![json_reply(201, "[]")]),
    ])
    .await;
    let body = multipart(&[
        text_part("bucket", "paper-images"),
        text_part("path", "user-1/a.png"),
        text_part("contentType", "image/png"),
        file_part("PNGDATA"),
    ]);
    let (status, value) = send(&up, upload_request(&body)).await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value, json!({"ok": true}));

    let puts = calls(&up, OBJECT);
    let put = puts.first().expect("object put");
    assert_eq!(put.method, "PUT");
    assert_eq!(put.body, b"PNGDATA".to_vec());
    assert_eq!(put.header("content-type"), Some("image/png"));

    let rows = calls(&up, BLOBS);
    let row = rows.first().expect("registry upsert");
    assert_eq!(row.method, "POST");
    assert_eq!(body_json(row)["size_bytes"], json!(7));
}

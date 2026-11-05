//! `/api/overleaf/workshop/*` over the HTTP router, against a stand-in for Overleaf and PostgREST.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::credential_crypto::{MISSING_KEY, open, seal};
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const TABLE: &str = "/rest/v1/overleaf_workshop_sessions";
const PREFIX: &str = "/api/overleaf/workshop";
const KEY: &str = "test-key";
const ID: &str = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const COOKIE: &str = "sid=secret-cookie";
const COMPILE: &str = "/project/p1/compile";
const META: &str = r#"<meta name="ol-user_id" content="u1"><meta name="ol-usersEmail" content="a@b.c"><meta name="ol-csrfToken" content="csrf-1">"#;
const COOKIE_REQUIRED: &str = "An Overleaf session cookie is required.";
const LOGIN_FAILED: &str = "Failed to get User ID.";
const NOT_FOUND: &str = "Overleaf session not found. Sign in again.";
const SESSION_ID_INVALID: &str =
    "A valid Overleaf session id is required. Sign in to Overleaf first.";
const PROJECT_ID_INVALID: &str = "A valid Overleaf project id is required.";
const SESSION_REQUIRED: &str = "Session id required.";
const SAVE_FAILED: &str = "Could not save the Overleaf session.";
const LOAD_FAILED: &str = "Could not load the Overleaf session.";
const REMOVE_FAILED: &str = "Could not remove the Overleaf session.";
const NO_PDF: &str = "The compile produced no PDF.";
const NOT_DOWNLOADED: &str = "The PDF could not be downloaded.";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// The Overleaf pages a cookie login reads: the user meta and the socket.io set-cookie.
fn login_routes() -> Vec<(&'static str, Vec<Reply>)> {
    vec![
        ("/project", vec![response(200, &[], META.as_bytes())]),
        (
            "/socket.io/socket.io.js",
            vec![response(
                200,
                &[("Set-Cookie", "connect.sid=abc; Path=/")],
                b"",
            )],
        ),
    ]
}

/// An upstream where `a.b.c` is user `user-1` and the cookie logs in. The given routes win.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.extend(login_routes());
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]));
    serve(routes).await
}

/// A stored session row holding `COOKIE`, sealed with `KEY`.
fn row_reply() -> Reply {
    let sealed = seal(COOKIE, Some(KEY)).expect("seal");
    json_reply(200, &json!([{"cookie_ciphertext": sealed}]).to_string())
}

/// Settings that send Overleaf requests to the stand-in, without retry delay.
fn settings(up: &Upstream, key: Option<&str>) -> SettingsConfig {
    SettingsConfig {
        overleaf_base: format!("http://127.0.0.1:{}/", up.port),
        overleaf_retry_ms: 0,
        credential_key: key.map(str::to_owned),
        ..SettingsConfig::default()
    }
}

fn state(up: &Upstream, settings: SettingsConfig) -> Arc<AppState> {
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
        storage: StorageConfig::default(),
        settings,
    })
}

/// A request to `uri`, with the session header when `auth` is set.
fn request(method: &str, uri: &str, body: &str, auth: bool) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if auth {
        builder = builder.header("authorization", SESSION);
    }
    builder.body(Body::from(body.to_owned())).expect("request")
}

/// Sends `req` through the router; returns status, headers and the raw body.
async fn call(
    up: &Upstream,
    settings: SettingsConfig,
    req: Request<Body>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let response = app(state(up, settings))
        .oneshot(req)
        .await
        .expect("router is infallible");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    (status, headers, bytes.to_vec())
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).expect("json body")
}

fn error_of(bytes: &[u8]) -> String {
    json(bytes)["error"].as_str().unwrap_or("").to_owned()
}

fn header(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .expect("header")
        .to_str()
        .expect("ascii")
        .to_string()
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

fn work_body() -> String {
    format!(r#"{{"sessionId":"{ID}","projectId":"p1","rootResourcePath":"main.tex"}}"#)
}

fn session_body() -> String {
    format!(r#"{{"sessionId":"{ID}"}}"#)
}

/// A compile reply whose `outputFiles` holds a `output.pdf` entry served at `/build/output.pdf`.
fn pdf_compile_reply() -> Reply {
    json_reply(
        200,
        r#"{"status":"success","compileGroup":"g","clsiServerId":"s1","outputFiles":[{"path":"output.pdf","url":"/build/output.pdf"}]}"#,
    )
}

#[tokio::test]
async fn session_empty_cookie_is_400() {
    let up = upstream(vec![]).await;
    let req = request(
        "POST",
        &format!("{PREFIX}/session"),
        r#"{"cookies":"   "}"#,
        true,
    );
    let (status, _, body) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&body), COOKIE_REQUIRED);
    assert!(calls(&up, "/project").is_empty());
}

#[tokio::test]
async fn session_without_meta_is_401() {
    let up = upstream(vec![(
        "/project",
        vec![response(200, &[], b"<html></html>")],
    )])
    .await;
    let body = json!({"cookies": COOKIE}).to_string();
    let req = request("POST", &format!("{PREFIX}/session"), &body, true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&reply), LOGIN_FAILED);
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn session_missing_key_is_502_without_cookie() {
    let up = upstream(vec![]).await;
    let body = json!({"cookies": COOKIE}).to_string();
    let req = request("POST", &format!("{PREFIX}/session"), &body, true);
    let (status, _, reply) = call(&up, settings(&up, None), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error_of(&reply), MISSING_KEY);
    assert!(!String::from_utf8_lossy(&reply).contains("secret-cookie"));
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn session_stores_sealed_cookie_and_returns_id() {
    let up = upstream(vec![(TABLE, vec![json_reply(201, r#"[{"id":"sess-1"}]"#)])]).await;
    let body = json!({"cookies": COOKIE}).to_string();
    let req = request("POST", &format!("{PREFIX}/session"), &body, true);
    let (status, headers, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json(&reply), json!({"sessionId": "sess-1"}));
    assert_eq!(header(&headers, "cache-control"), "no-store");
    let sent = calls(&up, TABLE);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].method, "POST");
    let row = body_json(&sent[0]);
    assert_eq!(row["user_id"], json!("user-1"));
    let sealed = row["cookie_ciphertext"].as_str().expect("ciphertext");
    assert!(!sealed.contains("secret-cookie"));
    assert_eq!(open(sealed, Some(KEY)).expect("open"), COOKIE);
}

#[tokio::test]
async fn session_insert_error_is_502_save_failed() {
    let up = upstream(vec![(
        TABLE,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    let body = json!({"cookies": COOKIE}).to_string();
    let req = request("POST", &format!("{PREFIX}/session"), &body, true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error_of(&reply), SAVE_FAILED);
    assert!(!String::from_utf8_lossy(&reply).contains("secret-cookie"));
}

#[tokio::test]
async fn delete_without_id_is_400() {
    let up = upstream(vec![]).await;
    let req = request("DELETE", &format!("{PREFIX}/session"), "", true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&reply), SESSION_REQUIRED);
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn delete_removes_own_row_and_is_ok() {
    let up = upstream(vec![(TABLE, vec![response(204, &[], b"")])]).await;
    let uri = format!("{PREFIX}/session?id={ID}");
    let req = request("DELETE", &uri, "", true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json(&reply), json!({"ok": true}));
    let sent = calls(&up, TABLE);
    assert_eq!(sent.len(), 1);
    assert!(sent[0].target.contains(&format!("id=eq.{ID}")));
    assert!(sent[0].target.contains("user_id=eq.user-1"));
}

#[tokio::test]
async fn delete_database_error_is_502() {
    let up = upstream(vec![(
        TABLE,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let uri = format!("{PREFIX}/session?id={ID}");
    let req = request("DELETE", &uri, "", true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error_of(&reply), REMOVE_FAILED);
}

#[tokio::test]
async fn projects_bad_session_id_is_400() {
    let up = upstream(vec![]).await;
    let body = json!({"sessionId": "not-a-session"}).to_string();
    let req = request("POST", &format!("{PREFIX}/projects"), &body, true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&reply), SESSION_ID_INVALID);
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn projects_missing_row_is_401_expired() {
    let up = upstream(vec![(TABLE, vec![json_reply(200, "[]")])]).await;
    let req = request("POST", &format!("{PREFIX}/projects"), &session_body(), true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json(&reply), json!({"error": NOT_FOUND, "expired": true}));
}

#[tokio::test]
async fn projects_maps_id_and_name() {
    let projects = r#"{"projects":[{"_id":"p1","name":"Thesis","extra":1}]}"#;
    let up = upstream(vec![
        (TABLE, vec![row_reply()]),
        ("/user/projects", vec![json_reply(200, projects)]),
    ])
    .await;
    let req = request("POST", &format!("{PREFIX}/projects"), &session_body(), true);
    let (status, headers, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(header(&headers, "cache-control"), "no-store");
    assert_eq!(
        json(&reply),
        json!({"projects": [{"id": "p1", "name": "Thesis"}]})
    );
    let sent = calls(&up, "/user/projects");
    assert_eq!(
        sent[0].header("cookie"),
        Some("sid=secret-cookie; connect.sid=abc")
    );
}

#[tokio::test]
async fn projects_load_error_is_502() {
    let up = upstream(vec![(
        TABLE,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let req = request("POST", &format!("{PREFIX}/projects"), &session_body(), true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error_of(&reply), LOAD_FAILED);
}

#[tokio::test]
async fn compile_bad_body_is_400() {
    let up = upstream(vec![]).await;
    let body = format!(r#"{{"sessionId":"{ID}","projectId":"a-b","rootResourcePath":"main.tex"}}"#);
    let req = request("POST", &format!("{PREFIX}/compile"), &body, true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&reply), PROJECT_ID_INVALID);
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn compile_missing_row_is_401_without_expired() {
    let up = upstream(vec![(TABLE, vec![json_reply(200, "[]")])]).await;
    let req = request("POST", &format!("{PREFIX}/compile"), &work_body(), true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json(&reply), json!({"error": NOT_FOUND}));
}

#[tokio::test]
async fn compile_returns_status_and_output_files() {
    let compiled = r#"{"status":"success","compileGroup":"g","stats":{},"outputFiles":[{"path":"output.pdf","url":"/build/output.pdf"}]}"#;
    let up = upstream(vec![
        (TABLE, vec![row_reply()]),
        (COMPILE, vec![json_reply(200, compiled)]),
    ])
    .await;
    let req = request("POST", &format!("{PREFIX}/compile"), &work_body(), true);
    let (status, headers, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(header(&headers, "cache-control"), "no-store");
    assert_eq!(
        json(&reply),
        json!({"status": "success", "outputFiles": [{"path": "output.pdf", "url": "/build/output.pdf"}]})
    );
    let sent = calls(&up, COMPILE);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].header("x-csrf-token"), Some("csrf-1"));
}

#[tokio::test]
async fn compile_overleaf_403_is_502() {
    let up = upstream(vec![
        (TABLE, vec![row_reply()]),
        (COMPILE, vec![response(403, &[], b"denied")]),
    ])
    .await;
    let req = request("POST", &format!("{PREFIX}/compile"), &work_body(), true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error_of(&reply), "403: denied");
}

#[tokio::test]
async fn pdf_returns_bytes_and_headers() {
    let up = upstream(vec![
        (TABLE, vec![row_reply()]),
        (COMPILE, vec![pdf_compile_reply()]),
        (
            "/build/output.pdf",
            vec![response(200, &[], b"%PDF-1.4 test")],
        ),
    ])
    .await;
    let req = request("POST", &format!("{PREFIX}/pdf"), &work_body(), true);
    let (status, headers, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(header(&headers, "content-type"), "application/pdf");
    assert_eq!(header(&headers, "cache-control"), "no-store");
    assert_eq!(reply, b"%PDF-1.4 test");
    let sent = calls(&up, "/build/output.pdf");
    assert_eq!(
        sent[0].header("cookie"),
        Some("sid=secret-cookie; connect.sid=abc")
    );
}

#[tokio::test]
async fn pdf_failure_status_is_502() {
    let failed = r#"{"status":"failure","compileGroup":"g","outputFiles":[]}"#;
    let up = upstream(vec![
        (TABLE, vec![row_reply()]),
        (COMPILE, vec![json_reply(200, failed)]),
    ])
    .await;
    let req = request("POST", &format!("{PREFIX}/pdf"), &work_body(), true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error_of(&reply), "Compile failed (status failure).");
}

#[tokio::test]
async fn pdf_without_output_pdf_is_502() {
    let no_pdf = r#"{"status":"success","compileGroup":"g","outputFiles":[{"path":"main.log","url":"/build/main.log"}]}"#;
    let up = upstream(vec![
        (TABLE, vec![row_reply()]),
        (COMPILE, vec![json_reply(200, no_pdf)]),
    ])
    .await;
    let req = request("POST", &format!("{PREFIX}/pdf"), &work_body(), true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error_of(&reply), NO_PDF);
}

#[tokio::test]
async fn pdf_empty_download_is_502() {
    // No `/build/output.pdf` route: the stand-in answers 404, so the download is empty.
    let up = upstream(vec![
        (TABLE, vec![row_reply()]),
        (COMPILE, vec![pdf_compile_reply()]),
    ])
    .await;
    let req = request("POST", &format!("{PREFIX}/pdf"), &work_body(), true);
    let (status, _, reply) = call(&up, settings(&up, Some(KEY)), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(error_of(&reply), NOT_DOWNLOADED);
}

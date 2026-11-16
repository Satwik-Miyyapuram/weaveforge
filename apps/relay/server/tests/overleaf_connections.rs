//! Overleaf connection routes (`/api/overleaf/connections`), over the HTTP router.
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
use wf_relay_server::credential_crypto::{MISSING_KEY, open};
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const TABLE: &str = "/rest/v1/overleaf_connections";
const PATH: &str = "/api/overleaf/connections";
const KEY: &str = "test-key";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where `a.b.c` is user `user-1`. The given routes win over the default.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]));
    serve(routes).await
}

fn keyed() -> SettingsConfig {
    SettingsConfig {
        mcp_enabled: true,
        credential_key: Some(KEY.to_string()),
        ..SettingsConfig::default()
    }
}

fn keyless() -> SettingsConfig {
    SettingsConfig::default()
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

/// Sends `req` through the router; returns status, headers and the JSON body.
async fn call(
    up: &Upstream,
    settings: SettingsConfig,
    req: Request<Body>,
) -> (StatusCode, HeaderMap, Value) {
    let response = app(state(up, settings))
        .oneshot(req)
        .await
        .expect("router is infallible");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    let value = serde_json::from_slice::<Value>(&bytes).expect("json body");
    (status, headers, value)
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

fn error_of(value: &Value) -> &str {
    value["error"].as_str().unwrap_or("")
}

#[tokio::test]
async fn get_without_auth_is_401_and_reads_nothing() {
    let up = upstream(vec![]).await;
    let (status, _, body) = call(&up, keyed(), request("GET", PATH, "", false)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&body), "Not authenticated.");
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn get_maps_rows_no_store_and_orders_by_updated_at() {
    let row = r#"[{"id":"c1","name":"Lab","token_prefix":"abcd","enabled":true,"created_at":"a","updated_at":"b"}]"#;
    let up = upstream(vec![(TABLE, vec![json_reply(200, row)])]).await;
    let (status, headers, body) = call(&up, keyless(), request("GET", PATH, "", true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"connections": [{"id": "c1", "name": "Lab", "token_prefix": "abcd", "enabled": true, "created_at": "a", "updated_at": "b"}]})
    );
    assert_eq!(header(&headers, "cache-control"), "no-store");
    let seen = calls(&up, TABLE);
    assert_eq!(seen.len(), 1);
    assert!(seen[0].target.contains("order=updated_at.desc"));
    assert!(seen[0].target.contains("select=id%2Cname%2Ctoken_prefix"));
}

#[tokio::test]
async fn get_database_error_is_500() {
    let up = upstream(vec![(
        TABLE,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let (status, _, _) = call(&up, keyless(), request("GET", PATH, "", true)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn post_without_auth_is_401_and_writes_nothing() {
    let up = upstream(vec![(TABLE, vec![json_reply(201, "[]")])]).await;
    let (status, _, body) = call(&up, keyed(), request("POST", PATH, "{}", false)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&body), "Not authenticated.");
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn post_bad_json_is_400() {
    let up = upstream(vec![(TABLE, vec![json_reply(201, "[]")])]).await;
    let (status, _, body) = call(&up, keyed(), request("POST", PATH, "{", true)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error_of(&body).starts_with("Invalid JSON body: "));
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn post_missing_or_non_string_fields_is_400() {
    let bodies = [
        r#"{"name":"Lab"}"#,
        r#"{"token":"abcdef"}"#,
        r#"{"name":"  ","token":"abcdef"}"#,
        r#"{"name":"Lab","token":"   "}"#,
        r#"{"name":5,"token":"abcdef"}"#,
        r#"[]"#,
    ];
    for payload in bodies {
        let up = upstream(vec![(TABLE, vec![json_reply(201, "[]")])]).await;
        let (status, _, body) = call(&up, keyed(), request("POST", PATH, payload, true)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{payload}");
        assert_eq!(
            error_of(&body),
            "Connection name and token are required.",
            "{payload}"
        );
        assert!(calls(&up, TABLE).is_empty(), "{payload}");
    }
}

#[tokio::test]
async fn post_without_key_is_503_and_writes_nothing() {
    let up = upstream(vec![(TABLE, vec![json_reply(201, "[]")])]).await;
    let payload = r#"{"name":"Lab","token":"abcdef"}"#;
    let (status, _, body) = call(&up, keyless(), request("POST", PATH, payload, true)).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error_of(&body), MISSING_KEY);
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn post_seals_token_stores_prefix_and_returns_row() {
    let reply = r#"[{"id":"c1","name":"Lab","token_prefix":"abcd","enabled":true}]"#;
    let up = upstream(vec![(TABLE, vec![json_reply(201, reply)])]).await;
    let payload = r#"{"name":"  Lab  ","token":"  abcdef-token  "}"#;
    let (status, headers, body) = call(&up, keyed(), request("POST", PATH, payload, true)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        body,
        json!({"connection": {"id": "c1", "name": "Lab", "token_prefix": "abcd", "enabled": true}})
    );
    assert_eq!(header(&headers, "cache-control"), "no-store");

    let seen = calls(&up, TABLE);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert!(seen[0].target.contains("select=id%2Cname%2Ctoken_prefix"));
    let row = body_json(&seen[0]);
    assert_eq!(row["user_id"], "user-1");
    assert_eq!(row["name"], "Lab");
    assert_eq!(row["token_prefix"], "abcd");
    assert!(row.get("token").is_none());
    let envelope = row["token_ciphertext"].as_str().expect("ciphertext");
    assert_ne!(envelope, "abcdef-token");
    assert_eq!(open(envelope, Some(KEY)).expect("open"), "abcdef-token");
}

#[tokio::test]
async fn post_database_error_is_500() {
    let up = upstream(vec![(
        TABLE,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let payload = r#"{"name":"Lab","token":"abcdef"}"#;
    let (status, _, _) = call(&up, keyed(), request("POST", PATH, payload, true)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn delete_without_id_is_400() {
    let up = upstream(vec![(TABLE, vec![json_reply(200, "")])]).await;
    let (status, _, body) = call(&up, keyless(), request("DELETE", PATH, "", true)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&body), "Connection id required.");
    assert!(calls(&up, TABLE).is_empty());
}

#[tokio::test]
async fn delete_filters_by_id() {
    let up = upstream(vec![(TABLE, vec![json_reply(200, "")])]).await;
    let uri = format!("{PATH}?id=c1");
    let (status, _, body) = call(&up, keyless(), request("DELETE", &uri, "", true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"ok": true}));
    let seen = calls(&up, TABLE);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "DELETE");
    assert!(seen[0].target.contains("id=eq.c1"));
}

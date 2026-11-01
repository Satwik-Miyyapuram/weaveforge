//! `POST /api/integrations/zotero/collections` over the HTTP router, against a stand-in for Zotero.
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
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const PATH: &str = "/api/integrations/zotero/collections";
const COLLECTIONS: &str = "/users/123/collections?limit=100";
const GOOD: &str = r#"{"apiKey":"k","library":"123"}"#;
const MISSING: &str = "A valid Zotero library and API key are required.";
const REJECTED: &str = "Zotero rejected the collection request.";
const UNEXPECTED: &str = "Zotero sent an unexpected response.";
const UNREACHABLE: &str = "Unable to reach Zotero.";

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

/// Settings that send Zotero requests to `zotero_api`.
fn settings(zotero_api: &str) -> SettingsConfig {
    SettingsConfig {
        zotero_api: zotero_api.to_owned(),
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

/// A collections POST with the session header when `auth` is set.
fn request(body: &str, auth: bool) -> Request<Body> {
    let mut builder = Request::builder().method("POST").uri(PATH);
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

/// The requests the upstream saw that were sent to Zotero (not the session check).
fn zotero_calls(up: &Upstream) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target != AUTH_USER)
        .collect()
}

fn api_base(up: &Upstream) -> String {
    up.base.as_str().trim_end_matches('/').to_owned()
}

#[tokio::test]
async fn no_session_is_401() {
    let up = upstream(vec![]).await;
    let (status, _, value) = call(&up, settings(&api_base(&up)), request(GOOD, false)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(value, json!({"error": "Not authenticated."}));
    assert!(zotero_calls(&up).is_empty());
}

#[tokio::test]
async fn invalid_json_is_400() {
    let up = upstream(vec![]).await;
    let (status, _, value) = call(&up, settings(&api_base(&up)), request("{not json", true)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        value["error"]
            .as_str()
            .is_some_and(|msg| msg.starts_with("Invalid JSON body:"))
    );
    assert!(zotero_calls(&up).is_empty());
}

#[tokio::test]
async fn bad_library_or_missing_key_is_400() {
    let up = upstream(vec![]).await;
    let bodies = [
        r#"{"apiKey":"k","library":"orgs/5"}"#,
        r#"{"apiKey":"k"}"#,
        r#"{"apiKey":"k","library":5}"#,
        r#"{"apiKey":"  ","library":"123"}"#,
        r#"{"library":"123"}"#,
    ];
    for body in bodies {
        let (status, _, value) = call(&up, settings(&api_base(&up)), request(body, true)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(value, json!({"error": MISSING}), "{body}");
    }
    assert!(zotero_calls(&up).is_empty());
}

#[tokio::test]
async fn sends_key_headers_and_limit_to_user_library() {
    let up = upstream(vec![(COLLECTIONS, vec![json_reply(200, "[]")])]).await;
    let body = r#"{"apiKey":"  k  ","library":" 123 "}"#;
    let (status, _, value) = call(&up, settings(&api_base(&up)), request(body, true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"collections": []}));
    let sent = calls(&up, "/users/");
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].method, "GET");
    assert_eq!(sent[0].target, COLLECTIONS);
    assert_eq!(sent[0].header("zotero-api-key"), Some("k"));
    assert_eq!(sent[0].header("zotero-api-version"), Some("3"));
}

#[tokio::test]
async fn maps_rows_and_drops_rows_without_key() {
    let rows = r#"[
        {"data":{"key":"AAA","name":"Thesis"}},
        {"data":{"key":"","name":"Empty"}},
        {"data":{"name":"NoKey"}},
        {"data":{"key":"BBB"}}
    ]"#;
    let up = upstream(vec![(COLLECTIONS, vec![json_reply(200, rows)])]).await;
    let (status, headers, value) = call(&up, settings(&api_base(&up)), request(GOOD, true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers.get("cache-control").expect("cache-control"),
        "no-store"
    );
    assert_eq!(
        value,
        json!({"collections": [
            {"key": "AAA", "name": "Thesis"},
            {"key": "BBB", "name": ""}
        ]})
    );
}

#[tokio::test]
async fn zotero_401_passes_through_and_other_failures_are_502() {
    let cases = [(401, 401), (403, 502), (500, 502)];
    for (upstream_status, expected) in cases {
        let up = upstream(vec![(
            COLLECTIONS,
            vec![json_reply(upstream_status, r#"{"message":"no"}"#)],
        )])
        .await;
        let (status, _, value) = call(&up, settings(&api_base(&up)), request(GOOD, true)).await;
        assert_eq!(status.as_u16(), expected, "upstream {upstream_status}");
        assert_eq!(value, json!({"error": REJECTED}));
    }
}

#[tokio::test]
async fn non_array_or_non_json_reply_is_502() {
    let replies = [r#"{"data":{}}"#, "not json"];
    for reply_body in replies {
        let up = upstream(vec![(COLLECTIONS, vec![json_reply(200, reply_body)])]).await;
        let (status, _, value) = call(&up, settings(&api_base(&up)), request(GOOD, true)).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY, "{reply_body}");
        assert_eq!(value, json!({"error": UNEXPECTED}), "{reply_body}");
    }
}

#[tokio::test]
async fn row_not_object_is_502() {
    let up = upstream(vec![(
        COLLECTIONS,
        vec![json_reply(200, r#"[{"data":{"key":"AAA"}}, 1]"#)],
    )])
    .await;
    let (status, _, value) = call(&up, settings(&api_base(&up)), request(GOOD, true)).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(value, json!({"error": UNEXPECTED}));
}

#[tokio::test]
async fn unreachable_zotero_is_502() {
    let up = upstream(vec![]).await;
    let (status, _, value) = call(&up, settings("http://127.0.0.1:1"), request(GOOD, true)).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(value, json!({"error": UNREACHABLE}));
}

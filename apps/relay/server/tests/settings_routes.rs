//! Settings token routes (`/api/settings/api-tokens`, `/api/settings/mcp-tokens`) over the HTTP router.
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
const TOKENS: &str = "/rest/v1/api_tokens";
const API: &str = "/api/settings/api-tokens";
const MCP: &str = "/api/settings/mcp-tokens";
const NOT_AUTH: &str = "Not authenticated.";
const ROW: &str = r#"{"id":"t1","name":"laptop","token_prefix":"tt_abc…","expires_at":null,"last_used_at":null,"created_at":"2026-01-01T00:00:00.000Z","scopes":["sdk"]}"#;

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

/// Settings with MCP switched on or off.
fn settings(mcp_enabled: bool) -> SettingsConfig {
    SettingsConfig {
        mcp_enabled,
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

/// A request with the given `Authorization` header, or none.
fn request_as(method: &str, uri: &str, body: &str, authorization: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(value) = authorization {
        builder = builder.header("authorization", value);
    }
    builder.body(Body::from(body.to_owned())).expect("request")
}

/// A request with the session header.
fn request(method: &str, uri: &str, body: &str) -> Request<Body> {
    request_as(method, uri, body, Some(SESSION))
}

/// A request with no session header.
fn anonymous(method: &str, uri: &str, body: &str) -> Request<Body> {
    request_as(method, uri, body, None)
}

/// Sends `req` through the router; returns status, headers and the JSON body.
async fn reply(
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
    (
        status,
        headers,
        serde_json::from_slice(&bytes).expect("json body"),
    )
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

#[tokio::test]
async fn every_token_route_refuses_without_a_session() {
    let up = upstream(vec![]).await;
    let requests = [
        anonymous("GET", API, ""),
        anonymous("POST", API, "{}"),
        anonymous("DELETE", "/api/settings/api-tokens?id=abc", ""),
        anonymous("GET", MCP, ""),
        anonymous("POST", MCP, ""),
        anonymous("DELETE", "/api/settings/mcp-tokens?id=abc", ""),
    ];
    for req in requests {
        let (status, _, value) = reply(&up, settings(true), req).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(value, json!({"error": NOT_AUTH}));
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn api_get_maps_rows_newest_first() {
    let up = upstream(vec![(TOKENS, vec![json_reply(200, &format!("[{ROW}]"))])]).await;
    let (status, _, value) = reply(&up, settings(true), request("GET", API, "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["tokens"][0]["tokenPrefix"], json!("tt_abc…"));
    assert!(value["tokens"][0].get("token_prefix").is_none());

    let sent = calls(&up, TOKENS);
    let first = sent.first().expect("select");
    assert!(first.target.contains("select="), "{}", first.target);
    assert!(
        first.target.contains("order=created_at.desc"),
        "{}",
        first.target
    );
}

#[tokio::test]
async fn api_get_reports_a_db_fault_as_500() {
    let up = upstream(vec![(
        TOKENS,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let (status, _, _) = reply(&up, settings(true), request("GET", API, "")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_get_refuses_a_non_jwt_session() {
    let up = upstream(vec![(TOKENS, vec![json_reply(200, "[]")])]).await;
    let req = request_as("GET", API, "", Some("Bearer tt_abc"));
    let (status, _, value) = reply(&up, settings(true), req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(value, json!({"error": "Invalid session."}));
    assert!(calls(&up, TOKENS).is_empty());
}

#[tokio::test]
async fn api_post_refuses_bad_bodies() {
    let up = upstream(vec![(TOKENS, vec![json_reply(201, "[]")])]).await;
    let cases = [
        ("null", "Expected a JSON object body."),
        ("5", "Expected a JSON object body."),
        (
            r#"{"name":"x","expiresInDays":1.5}"#,
            "expiresInDays must be a whole number of days (0 to 36500), or null.",
        ),
        (r#"{"name":"  "}"#, "Token name is required."),
        ("[]", "Token name is required."),
    ];
    for (body, message) in cases {
        let (status, _, value) = reply(&up, settings(true), request("POST", API, body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(value, json!({"error": message}), "{body}");
    }
    let (status, _, value) = reply(&up, settings(true), request("POST", API, "{not json")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let message = value["error"].as_str().unwrap_or_default();
    assert!(message.starts_with("Invalid JSON body: "), "{message}");
    assert!(calls(&up, TOKENS).is_empty());
}

#[tokio::test]
async fn api_post_checks_the_body_before_the_session() {
    let up = upstream(vec![(TOKENS, vec![json_reply(201, "[]")])]).await;
    let req = request("POST", API, r#"{"name":"x","expiresInDays":1.5}"#);
    let (status, _, _) = reply(&up, settings(true), req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn api_post_inserts_a_hashed_row_and_returns_the_plaintext() {
    let up = upstream(vec![(TOKENS, vec![json_reply(201, &format!("[{ROW}]"))])]).await;
    let req = request("POST", API, r#"{"name":"  laptop  "}"#);
    let (status, _, value) = reply(&up, settings(true), req).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        value["plaintext"]
            .as_str()
            .unwrap_or_default()
            .starts_with("tt_")
    );
    assert_eq!(value["record"]["tokenPrefix"], json!("tt_abc…"));

    let posts: Vec<Seen> = calls(&up, TOKENS)
        .into_iter()
        .filter(|seen| seen.method == "POST")
        .collect();
    let post = posts.first().expect("insert");
    assert!(
        post.header("prefer")
            .unwrap_or_default()
            .contains("return=representation")
    );
    let sent = body_json(post);
    assert_eq!(sent["user_id"], json!("user-1"));
    assert_eq!(sent["name"], json!("laptop"));
    assert_eq!(sent["scopes"], json!(["sdk"]));
    assert!(sent["expires_at"].is_null());
    assert!(
        sent["token_prefix"]
            .as_str()
            .unwrap_or_default()
            .ends_with('…')
    );
    let hash = sent["token_hash"].as_str().unwrap_or_default();
    let digest = hash.strip_prefix("\\x").unwrap_or_default();
    assert_eq!(digest.len(), 64, "{hash}");
    assert!(digest.chars().all(|c| c.is_ascii_hexdigit()));
}

#[tokio::test]
async fn api_post_with_expiry_sets_expires_at() {
    let up = upstream(vec![(TOKENS, vec![json_reply(201, &format!("[{ROW}]"))])]).await;
    let req = request("POST", API, r#"{"name":"x","expiresInDays":30}"#);
    let (status, _, _) = reply(&up, settings(true), req).await;
    assert_eq!(status, StatusCode::OK);
    let posts: Vec<Seen> = calls(&up, TOKENS)
        .into_iter()
        .filter(|seen| seen.method == "POST")
        .collect();
    let sent = body_json(posts.first().expect("insert"));
    assert!(sent["expires_at"].is_string());
}

#[tokio::test]
async fn api_post_reports_a_missing_row_as_500() {
    let up = upstream(vec![(TOKENS, vec![json_reply(201, "[]")])]).await;
    let (status, _, value) =
        reply(&up, settings(true), request("POST", API, r#"{"name":"x"}"#)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(value, json!({"error": "Token was not saved."}));
}

#[tokio::test]
async fn api_delete_needs_an_id() {
    let up = upstream(vec![]).await;
    let (status, _, value) = reply(
        &up,
        settings(true),
        request("DELETE", "/api/settings/api-tokens?id=%20", ""),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Token id required."}));
    assert!(calls(&up, TOKENS).is_empty());
}

#[tokio::test]
async fn api_delete_reports_missing_and_removed_tokens() {
    let up = upstream(vec![(
        TOKENS,
        vec![
            response(200, &[("Content-Range", "*/0")], b""),
            response(200, &[("Content-Range", "*/1")], b""),
        ],
    )])
    .await;
    let uri = "/api/settings/api-tokens?id=abc";
    let (status, _, value) = reply(&up, settings(true), request("DELETE", uri, "")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(value, json!({"error": "Token not found."}));

    let (status, _, value) = reply(&up, settings(true), request("DELETE", uri, "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));

    let deletes = calls(&up, TOKENS);
    let first = deletes.first().expect("delete");
    assert_eq!(first.method, "DELETE");
    assert!(first.target.contains("id=eq.abc"), "{}", first.target);
}

#[tokio::test]
async fn mcp_routes_refuse_when_disabled() {
    let up = upstream(vec![]).await;
    let requests = [
        anonymous("GET", MCP, ""),
        anonymous("POST", MCP, ""),
        anonymous("DELETE", "/api/settings/mcp-tokens?id=abc", ""),
        request("GET", MCP, ""),
    ];
    for req in requests {
        let (status, headers, value) = reply(&up, settings(false), req).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(value, json!({"error": "mcp_disabled"}));
        assert_eq!(
            headers
                .get("cache-control")
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn mcp_get_keeps_only_mcp_scoped_rows() {
    let rows = json!([
        {"id": "a", "name": "mcp", "token_prefix": "tt_a…", "scopes": ["mcp_relay"]},
        {"id": "b", "name": "sdk", "token_prefix": "tt_b…", "scopes": ["sdk"]},
        {"id": "c", "name": "both", "token_prefix": "tt_c…", "scopes": ["mcp_relay", "sdk"]},
        {"id": "d", "name": "none", "token_prefix": "tt_d…", "scopes": null}
    ]);
    let up = upstream(vec![(TOKENS, vec![json_reply(200, &rows.to_string())])]).await;
    let (status, _, value) = reply(&up, settings(true), request("GET", MCP, "")).await;
    assert_eq!(status, StatusCode::OK);
    let tokens = value["tokens"].as_array().expect("tokens");
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens[0]["id"], json!("a"));
}

#[tokio::test]
async fn mcp_post_inserts_an_mcp_relay_row() {
    let row = r#"[{"id":"m1","name":"Codex MCP connection","token_prefix":"tt_x…","expires_at":null,"last_used_at":null,"created_at":"2026-01-01T00:00:00.000Z","scopes":["mcp_relay"]}]"#;
    let up = upstream(vec![(TOKENS, vec![json_reply(201, row)])]).await;
    let (status, _, value) = reply(&up, settings(true), request("POST", MCP, "")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        value["plaintext"]
            .as_str()
            .unwrap_or_default()
            .starts_with("tt_")
    );
    assert_eq!(value["record"]["scopes"], json!(["mcp_relay"]));

    let posts: Vec<Seen> = calls(&up, TOKENS)
        .into_iter()
        .filter(|seen| seen.method == "POST")
        .collect();
    let sent = body_json(posts.first().expect("insert"));
    assert_eq!(sent["user_id"], json!("user-1"));
    assert_eq!(sent["name"], json!("Codex MCP connection"));
    assert_eq!(sent["scopes"], json!(["mcp_relay"]));
    assert!(sent["expires_at"].is_null());
}

#[tokio::test]
async fn mcp_delete_removes_a_token() {
    let up = upstream(vec![(
        TOKENS,
        vec![response(200, &[("Content-Range", "*/1")], b"")],
    )])
    .await;
    let req = request("DELETE", "/api/settings/mcp-tokens?id=m1", "");
    let (status, _, value) = reply(&up, settings(true), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));
    let deletes = calls(&up, TOKENS);
    assert!(deletes.first().expect("delete").target.contains("id=eq.m1"));
}

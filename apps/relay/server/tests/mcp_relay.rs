//! MCP relay routes (`/api/mcp`, `/api/mcp/relay*`), over the HTTP router.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_core::sync::instant::parse_instant;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const API_TOKEN: &str = "Bearer tt_0123456789abcdefghijklmnop";
const AUTH_USER: &str = "/auth/v1/user";
const SCOPES: &str = "/rest/v1/rpc/api_token_scopes";
const RESOLVE_MCP: &str = "/rest/v1/rpc/resolve_mcp_relay_token";
const RELAY: &str = "/rest/v1/ai_mcp_relay_requests";
const CLAIM: &str = "/rest/v1/rpc/claim_ai_mcp_relay_requests";
const SESSION_ID: &str = "00000000-0000-4000-8000-000000000002";
const REQ_ID: &str = "00000000-0000-4000-8000-000000000003";
const PATH: &str = "/api/mcp/relay";
const BROWSER: &str = "/api/mcp/relay/browser";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

fn envelope() -> Value {
    json!({"iv": "aXY=", "ciphertext": "Y3Q="})
}

/// An upstream where `a.b.c` is user `user-1`. The given routes win over the default.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]));
    serve(routes).await
}

fn enabled() -> SettingsConfig {
    SettingsConfig {
        mcp_enabled: true,
        ..SettingsConfig::default()
    }
}

fn disabled() -> SettingsConfig {
    SettingsConfig {
        mcp_enabled: false,
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

/// A request with an optional `Authorization` header and a JSON body.
fn request(method: &str, uri: &str, auth: Option<&str>, body: &str) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(auth) = auth {
        builder = builder.header("authorization", auth);
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

fn now_ms() -> i64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("after epoch")
        .as_millis();
    i64::try_from(millis).expect("fits")
}

#[tokio::test]
async fn every_route_is_404_when_mcp_is_disabled() {
    let up = upstream(vec![]).await;
    let cases = [
        ("GET", "/api/mcp"),
        ("POST", "/api/mcp"),
        ("POST", PATH),
        ("GET", "/api/mcp/relay?id=x"),
        ("PATCH", PATH),
        ("GET", "/api/mcp/relay/browser?sessionId=x"),
    ];
    for (method, uri) in cases {
        let req = request(method, uri, Some(SESSION), "{}");
        let (status, headers, body) = call(&up, disabled(), req).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {uri}");
        assert_eq!(error_of(&body), "mcp_disabled");
        assert_eq!(header(&headers, "cache-control"), "no-store");
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn mcp_get_and_post_answer_pairing_required_with_tools() {
    let up = upstream(vec![]).await;
    for method in ["GET", "POST"] {
        let req = request(method, "/api/mcp", None, "");
        let (status, headers, body) = call(&up, enabled(), req).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["error"], "browser_pairing_required");
        assert_eq!(
            body["message"],
            "Open WeaveForge and unlock encryption to access this workspace."
        );
        let tools = body["tools"].as_array().expect("tools");
        assert_eq!(tools.len(), 13);
        assert_eq!(tools[0]["name"], "search_workspace");
        assert_eq!(header(&headers, "cache-control"), "no-store");
        assert_eq!(header(&headers, "x-robots-tag"), "noindex");
    }
}

#[tokio::test]
async fn relay_post_without_auth_is_401() {
    let up = upstream(vec![]).await;
    let req = request("POST", PATH, None, "{}");
    let (status, _, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&body), "Not authenticated.");
    assert!(calls(&up, RELAY).is_empty());
}

#[tokio::test]
async fn relay_post_declared_length_is_413_before_body_parse() {
    let up = upstream(vec![]).await;
    let req = Request::builder()
        .method("POST")
        .uri(PATH)
        .header("authorization", SESSION)
        .header("content-length", "70000")
        .body(Body::from("not json"))
        .expect("request");
    let (status, _, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(error_of(&body), "Relay body is too large.");
    assert!(calls(&up, RELAY).is_empty());
}

#[tokio::test]
async fn relay_post_refuses_bad_bodies() {
    let up = upstream(vec![]).await;
    let cases = [
        ("{", 400, "Invalid JSON body: "),
        ("[]", 400, "The body must be a JSON object."),
        ("{}", 400, "sessionId and encrypted envelope are required."),
        (
            r#"{"sessionId":"","envelope":{"iv":"a","ciphertext":"b"}}"#,
            400,
            "sessionId and encrypted envelope are required.",
        ),
        (
            r#"{"sessionId":"x","envelope":{"iv":"a"}}"#,
            400,
            "sessionId and encrypted envelope are required.",
        ),
        (
            r#"{"sessionId":"not-a-uuid","envelope":{"iv":"a","ciphertext":"b"}}"#,
            400,
            "sessionId must be a UUID.",
        ),
    ];
    for (body, status, message) in cases {
        let req = request("POST", PATH, Some(SESSION), body);
        let (got, _, reply) = call(&up, enabled(), req).await;
        assert_eq!(got.as_u16(), status, "{body}");
        assert!(error_of(&reply).starts_with(message), "{body}");
    }
    assert!(calls(&up, RELAY).is_empty());
}

#[tokio::test]
async fn relay_post_inserts_request_with_minimum_ttl() {
    let row = json!([{"id": "req-1", "status": "pending", "expires_at": "x"}]);
    let up = upstream(vec![(RELAY, vec![json_reply(201, &row.to_string())])]).await;
    let payload = json!({"sessionId": SESSION_ID, "envelope": envelope(), "ttlMs": 1});
    let before = now_ms();
    let req = request("POST", PATH, Some(SESSION), &payload.to_string());
    let (status, headers, body) = call(&up, enabled(), req).await;
    let after = now_ms();

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["request"]["id"], "req-1");
    assert_eq!(header(&headers, "cache-control"), "no-store");

    let seen = calls(&up, RELAY);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert!(seen[0].target.contains("select="));
    let stored = body_json(&seen[0]);
    assert_eq!(stored["user_id"], "user-1");
    assert_eq!(stored["session_id"], SESSION_ID);
    assert_eq!(stored["request_enc"], envelope());
    let expires = parse_instant(stored["expires_at"].as_str().expect("iso")).expect("instant");
    assert!(expires >= before + 15_000 && expires <= after + 15_000);
}

#[tokio::test]
async fn relay_post_database_error_is_500() {
    let up = upstream(vec![(
        RELAY,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let payload = json!({"sessionId": SESSION_ID, "envelope": envelope()});
    let req = request("POST", PATH, Some(SESSION), &payload.to_string());
    let (status, _, _) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn mcp_relay_token_is_accepted_for_relay_post() {
    let up = upstream(vec![
        (SCOPES, vec![json_reply(200, r#"["mcp_relay"]"#)]),
        (RESOLVE_MCP, vec![json_reply(200, r#""user-1""#)]),
        (
            RELAY,
            vec![json_reply(201, r#"[{"id":"req-2","status":"pending"}]"#)],
        ),
    ])
    .await;
    let payload = json!({"sessionId": SESSION_ID, "envelope": envelope()});
    let req = request("POST", PATH, Some(API_TOKEN), &payload.to_string());
    let (status, _, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["request"]["id"], "req-2");
    assert_eq!(body_json(&calls(&up, RELAY)[0])["user_id"], "user-1");
}

#[tokio::test]
async fn sdk_token_is_refused_for_relay_post() {
    let up = upstream(vec![(SCOPES, vec![json_reply(200, r#"["sdk"]"#)])]).await;
    let payload = json!({"sessionId": SESSION_ID, "envelope": envelope()});
    let req = request("POST", PATH, Some(API_TOKEN), &payload.to_string());
    let (status, _, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&body), "Invalid or expired MCP token.");
    assert!(calls(&up, RELAY).is_empty());
}

#[tokio::test]
async fn relay_get_requires_a_uuid_id() {
    let up = upstream(vec![]).await;
    let cases = [
        ("", "id is required."),
        ("?id=", "id is required."),
        ("?id=not-a-uuid", "id must be a UUID."),
    ];
    for (query, message) in cases {
        let req = request("GET", &format!("{PATH}{query}"), Some(SESSION), "");
        let (status, _, body) = call(&up, enabled(), req).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{query}");
        assert_eq!(error_of(&body), message);
    }
}

#[tokio::test]
async fn relay_get_missing_row_is_404() {
    let up = upstream(vec![(RELAY, vec![json_reply(200, "[]")])]).await;
    let req = request("GET", &format!("{PATH}?id={REQ_ID}"), Some(SESSION), "");
    let (status, _, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_of(&body), "Relay request not found.");
    assert!(
        calls(&up, RELAY)[0]
            .target
            .contains(&format!("id=eq.{REQ_ID}"))
    );
}

#[tokio::test]
async fn relay_get_reads_past_expiry_as_expired() {
    let stale =
        json!([{"id": REQ_ID, "status": "pending", "expires_at": "2000-01-01T00:00:00.000Z"}]);
    let up = upstream(vec![(RELAY, vec![json_reply(200, &stale.to_string())])]).await;
    let req = request("GET", &format!("{PATH}?id={REQ_ID}"), Some(SESSION), "");
    let (status, headers, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["request"]["status"], "expired");
    assert_eq!(header(&headers, "cache-control"), "no-store");
}

#[tokio::test]
async fn relay_get_keeps_pending_before_expiry() {
    let fresh =
        json!([{"id": REQ_ID, "status": "pending", "expires_at": "2999-01-01T00:00:00.000Z"}]);
    let up = upstream(vec![(RELAY, vec![json_reply(200, &fresh.to_string())])]).await;
    let req = request("GET", &format!("{PATH}?id={REQ_ID}"), Some(SESSION), "");
    let (_, _, body) = call(&up, enabled(), req).await;
    assert_eq!(body["request"]["status"], "pending");
}

#[tokio::test]
async fn relay_patch_stores_reply_with_claim_filter() {
    let up = upstream(vec![(
        RELAY,
        vec![json_reply(200, &format!(r#"[{{"id":"{REQ_ID}"}}]"#))],
    )])
    .await;
    let payload = json!({"id": REQ_ID, "envelope": envelope()});
    let req = Request::builder()
        .method("PATCH")
        .uri(PATH)
        .header("authorization", SESSION)
        .body(Body::from(payload.to_string()))
        .expect("request");
    let (status, _, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"ok": true}));

    let seen = calls(&up, RELAY);
    assert_eq!(seen[0].method, "PATCH");
    assert!(seen[0].target.contains("status=eq.claimed"));
    assert!(seen[0].target.contains("expires_at=gt."));
    let patch = body_json(&seen[0]);
    assert_eq!(patch["status"], "complete");
    assert_eq!(patch["response_enc"], envelope());
    assert!(patch["completed_at"].is_string());
}

#[tokio::test]
async fn relay_patch_cancel_clears_reply() {
    let up = upstream(vec![(
        RELAY,
        vec![json_reply(200, &format!(r#"[{{"id":"{REQ_ID}"}}]"#))],
    )])
    .await;
    let payload = json!({"id": REQ_ID, "status": "cancelled"});
    let req = request("PATCH", PATH, Some(SESSION), &payload.to_string());
    let (status, _, _) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::OK);
    let patch = body_json(&calls(&up, RELAY)[0]);
    assert_eq!(patch["status"], "cancelled");
    assert!(patch["response_enc"].is_null());
}

#[tokio::test]
async fn relay_patch_refuses_bad_input() {
    let up = upstream(vec![]).await;
    let cases = [
        ("[]", "The body must be a JSON object."),
        (
            r#"{"envelope":{"iv":"a","ciphertext":"b"}}"#,
            "id and encrypted response are required.",
        ),
        (
            r#"{"id":"x","status":"complete"}"#,
            "id and encrypted response are required.",
        ),
        (r#"{"id":"x","status":"cancelled"}"#, "id must be a UUID."),
    ];
    for (body, message) in cases {
        let req = request("PATCH", PATH, Some(SESSION), body);
        let (status, _, reply) = call(&up, enabled(), req).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(error_of(&reply), message);
    }
    assert!(calls(&up, RELAY).is_empty());
}

#[tokio::test]
async fn relay_patch_no_claimable_row_is_409() {
    let up = upstream(vec![(RELAY, vec![json_reply(200, "[]")])]).await;
    let payload = json!({"id": REQ_ID, "envelope": envelope()});
    let req = request("PATCH", PATH, Some(SESSION), &payload.to_string());
    let (status, _, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_of(&body), "Relay request is no longer claimable.");
}

#[tokio::test]
async fn browser_claims_for_session_and_reads_null_as_empty() {
    let up = upstream(vec![(CLAIM, vec![json_reply(200, r#"[{"id":"r"}]"#)])]).await;
    let req = request(
        "GET",
        &format!("{BROWSER}?sessionId={SESSION_ID}"),
        Some(SESSION),
        "",
    );
    let (status, headers, body) = call(&up, enabled(), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"requests": [{"id": "r"}]}));
    assert_eq!(header(&headers, "cache-control"), "no-store");
    let rpc = calls(&up, CLAIM);
    assert_eq!(rpc[0].method, "POST");
    assert_eq!(
        body_json(&rpc[0]),
        json!({"p_session_id": SESSION_ID, "p_limit": 5})
    );

    let empty = upstream(vec![(CLAIM, vec![json_reply(200, "")])]).await;
    let req = request(
        "GET",
        &format!("{BROWSER}?sessionId={SESSION_ID}"),
        Some(SESSION),
        "",
    );
    let (_, _, body) = call(&empty, enabled(), req).await;
    assert_eq!(body, json!({"requests": []}));
}

#[tokio::test]
async fn browser_refuses_missing_or_bad_session_id() {
    let up = upstream(vec![]).await;
    let cases = [
        (BROWSER.to_string(), "sessionId is required."),
        (
            format!("{BROWSER}?sessionId=nope"),
            "sessionId must be a UUID.",
        ),
    ];
    for (uri, message) in cases {
        let req = request("GET", &uri, Some(SESSION), "");
        let (status, _, body) = call(&up, enabled(), req).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(error_of(&body), message);
    }
    assert!(calls(&up, CLAIM).is_empty());
}

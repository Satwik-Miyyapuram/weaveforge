#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    missing_docs,
    unused_results
)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::postgrest::UserDb;
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::sdk_inbox::enqueue;
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const API_TOKEN: &str = "tt_0123456789abcdefghijklmnop";
const AUTH_USER: &str = "/auth/v1/user";
const SCOPES: &str = "/rest/v1/rpc/api_token_scopes";
const CLAIM: &str = "/rest/v1/rpc/sdk_inbox_claim";
const INBOX: &str = "/rest/v1/sdk_inbox";

type Routes = Vec<(&'static str, Vec<Reply>)>;

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

/// An upstream where `a.b.c` is user `u1`, plus the given routes.
fn with_auth(rest: Routes) -> Routes {
    let mut routes = vec![(AUTH_USER, vec![json_reply(200, r#"{"id":"u1"}"#)])];
    routes.extend(rest);
    routes
}

fn state(up: &Upstream) -> Arc<AppState> {
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
        settings: SettingsConfig::default(),
    })
}

fn request(method: &str, uri: &str, authorization: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", authorization)
        .body(Body::from(body.to_owned()))
        .expect("request")
}

/// Sends one request to a fresh upstream; the status, JSON reply and what the upstream saw.
async fn call(routes: Routes, request: Request<Body>) -> (StatusCode, Value, Vec<Seen>) {
    let up = serve(routes).await;
    let response = app(state(&up)).oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        up.seen(),
    )
}

#[tokio::test]
async fn sdk_inbox_claim_returns_rows() {
    let routes = with_auth(vec![(CLAIM, vec![json_reply(200, r#"[{"id":6}]"#)])]);
    let req = request("GET", "/api/sdk/inbox?after=5&device=d1", SESSION, "");
    let (status, body, seen) = call(routes, req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"].as_array().unwrap().len(), 1);
    assert_eq!(body["items"][0]["id"], json!(6));
    let rpc = seen
        .iter()
        .find(|s| s.target == CLAIM)
        .expect("claim rpc called");
    let sent: Value = serde_json::from_slice(&rpc.body).unwrap();
    assert_eq!(sent["p_after"], json!(5));
    assert_eq!(sent["p_device"], json!("d1"));
    assert_eq!(sent["p_limit"], json!(100));
}

#[tokio::test]
async fn sdk_inbox_requires_device() {
    let routes = with_auth(vec![(CLAIM, vec![json_reply(200, "[]")])]);
    let req = request("GET", "/api/sdk/inbox?after=5", SESSION, "");
    let (status, body, seen) = call(routes, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"error": "Missing device."}));
    assert!(seen.iter().all(|s| s.target != CLAIM));
}

#[tokio::test]
async fn sdk_inbox_refuses_api_token() {
    let routes = with_auth(vec![(CLAIM, vec![json_reply(200, "[]")])]);
    let header = format!("Bearer {API_TOKEN}");
    let req = request("GET", "/api/sdk/inbox?device=d1", &header, "");
    let (status, _, seen) = call(routes, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(seen.is_empty());
}

#[tokio::test]
async fn token_wrong_scope() {
    let routes = vec![(SCOPES, vec![json_reply(200, r#"["mcp_relay"]"#)])];
    let header = format!("Bearer {API_TOKEN}");
    let req = request("POST", "/api/sdk/metrics", &header, r#"{"points":[]}"#);
    let (status, body, seen) = call(routes, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({"error": "Invalid or expired API token."}));
    assert_eq!(seen.len(), 1);
}

#[tokio::test]
async fn sdk_inbox_ack_idempotent() {
    let up = serve(with_auth(vec![(
        INBOX,
        vec![empty_reply(204), empty_reply(204)],
    )]))
    .await;
    for _ in 0..2 {
        let req = request(
            "POST",
            "/api/sdk/inbox/ack",
            SESSION,
            r#"{"ids":[1,2],"device":"d1"}"#,
        );
        let response = app(state(&up)).oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    let deletes: Vec<Seen> = up
        .seen()
        .into_iter()
        .filter(|s| s.method == "DELETE")
        .collect();
    assert_eq!(deletes.len(), 2);
    for delete in &deletes {
        assert!(
            delete.target.contains("id=in.%281%2C2%29"),
            "{}",
            delete.target
        );
    }
}

#[tokio::test]
async fn sdk_inbox_ack_empty_skips_db() {
    let req = request(
        "POST",
        "/api/sdk/inbox/ack",
        SESSION,
        r#"{"ids":[],"device":"d1"}"#,
    );
    let (status, body, seen) = call(with_auth(vec![]), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"ok": true}));
    assert!(seen.iter().all(|s| s.method != "DELETE"));
}

#[tokio::test]
async fn sdk_inbox_ack_rejects_bad_ids() {
    let req = request("POST", "/api/sdk/inbox/ack", SESSION, r#"{"ids":["x"]}"#);
    let (status, body, _) = call(with_auth(vec![]), req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"error": "Invalid ids."}));
}

#[tokio::test]
async fn enqueue_metrics_row() {
    let up = serve(vec![(INBOX, vec![empty_reply(201)])]).await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let db = UserDb::new(&client, &data_url, "anon", "tok");
    let payload = json!({"experiment_id": "e1", "points": []});
    let response = enqueue(&db, "metrics", Some(payload.clone())).await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    let row: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(row["kind"], json!("metrics"));
    assert_eq!(row["experiment_id"], json!("e1"));
    assert_eq!(row["payload"], payload);
}

#[tokio::test]
async fn enqueue_rejects_non_object() {
    let up = serve(vec![(INBOX, vec![empty_reply(201)])]).await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let db = UserDb::new(&client, &data_url, "anon", "tok");
    for bad in [Some(json!([1])), Some(json!("x")), None] {
        let response = enqueue(&db, "metrics", bad).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn sdk_inbox_ack_requires_device() {
    let req = request("POST", "/api/sdk/inbox/ack", SESSION, r#"{"ids":[1]}"#);
    let (status, body, seen) = call(with_auth(vec![]), req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"error": "Missing device."}));
    assert!(seen.iter().all(|s| s.method != "DELETE"));
}

#[tokio::test]
async fn sdk_inbox_ack_only_deletes_rows_claimed_by_device() {
    let up = serve(with_auth(vec![(INBOX, vec![empty_reply(204)])])).await;
    let req = request(
        "POST",
        "/api/sdk/inbox/ack",
        SESSION,
        r#"{"ids":[7],"device":"laptop"}"#,
    );
    let response = app(state(&up)).oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let delete = up
        .seen()
        .into_iter()
        .find(|s| s.method == "DELETE")
        .unwrap();
    assert!(
        delete.target.contains("claimed_by=eq.laptop"),
        "{}",
        delete.target
    );
}

#[tokio::test]
async fn enqueue_refuses_binary_fields_without_queuing() {
    let up = serve(vec![(INBOX, vec![empty_reply(201)])]).await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let db = UserDb::new(&client, &data_url, "anon", "tok");
    for field in ["dataBase64", "data"] {
        let mut payload = json!({"experiment_id": "e1", "name": "a.txt"});
        payload[field] = json!("AAAA");
        let response = enqueue(&db, "artifacts", Some(payload)).await;
        assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn enqueue_refuses_oversize_body() {
    let up = serve(vec![(INBOX, vec![empty_reply(201)])]).await;
    let client = reqwest::Client::new();
    let data_url = format!("http://127.0.0.1:{}/rest/v1", up.port);
    let db = UserDb::new(&client, &data_url, "anon", "tok");
    let big = "x".repeat(256 * 1024 + 1);
    let response = enqueue(
        &db,
        "metrics",
        Some(json!({"experiment_id": "e1", "note": big})),
    )
    .await;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert!(up.seen().is_empty());
}

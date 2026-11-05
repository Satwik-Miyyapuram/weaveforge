//! `POST /api/account/delete-user` and its `/otp` step over the HTTP router, against a stand-in for Supabase.
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
const DELETE_USER: &str = "/api/account/delete-user";
const DELETE_OTP: &str = "/api/account/delete-user/otp";
const AUTH_USER: &str = "/auth/v1/user";
const PROFILES: &str = "/rest/v1/profiles";
const OTP: &str = "/auth/v1/otp";
const VERIFY: &str = "/auth/v1/verify";
const BLOBS: &str = "/rest/v1/blob_objects";
const RPC: &str = "/rest/v1/rpc/delete_user_account_data";
const ADMIN_DELETE: &str = "/auth/v1/admin/users/u1";
const PROFILE_OK: &str = r#"[{"user_id":"u1","email":"jane@example.com","full_name":"Jane","role":"professor","supervisor_id":null}]"#;
const CONFIRMED: &str = r#"{"confirmation":"DELETE_USER","otp":"123456"}"#;

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where `a.b.c` is user `u1` with the given profile reply.
/// `overrides` answer before the defaults, so a test can change one path.
async fn upstream(profile: &str, overrides: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = overrides;
    routes.extend([
        (AUTH_USER, vec![json_reply(200, r#"{"id":"u1"}"#)]),
        (PROFILES, vec![json_reply(200, profile)]),
        (OTP, vec![json_reply(200, "{}")]),
        (VERIFY, vec![json_reply(200, r#"{"id":"u1"}"#)]),
        (BLOBS, vec![json_reply(200, "[]")]),
        (RPC, vec![json_reply(200, "null")]),
        (ADMIN_DELETE, vec![json_reply(200, "{}")]),
    ]);
    routes.extend(
        [
            "/storage/v1/object/list/paper-images",
            "/storage/v1/object/list/experiment-artifacts",
            "/storage/v1/object/list/vault-assets",
            "/storage/v1/object/list/report-images",
            "/storage/v1/object/list/log-images",
        ]
        .into_iter()
        .map(|path| (path, vec![json_reply(200, "[]")])),
    );
    serve(routes).await
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

/// A POST to `path` with `body` and the given `Authorization` header, or none.
fn post(path: &str, body: &str, authorization: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method("POST").uri(path);
    if let Some(value) = authorization {
        builder = builder.header("authorization", value);
    }
    builder.body(Body::from(body.to_owned())).expect("request")
}

/// Sends `req` through the router; returns status, headers and the JSON body.
async fn reply(up: &Upstream, req: Request<Body>) -> (StatusCode, HeaderMap, Value) {
    let response = app(state(up))
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

/// The requests with the given method and target that the upstream saw.
fn calls(up: &Upstream, method: &str, target: &str) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.method == method && seen.target == target)
        .collect()
}

#[tokio::test]
async fn no_session_is_401_on_both_routes() {
    let up = upstream(PROFILE_OK, vec![]).await;
    for path in [DELETE_USER, DELETE_OTP] {
        let (status, _, value) = reply(&up, post(path, CONFIRMED, None)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(value, json!({"error": "Not authenticated."}), "{path}");
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn unknown_profile_is_401() {
    let up = upstream("[]", vec![]).await;
    let (status, _, value) = reply(&up, post(DELETE_OTP, "", Some(SESSION))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(value, json!({"error": "Invalid session."}));
}

#[tokio::test]
async fn profile_without_email_is_400() {
    let profile = r#"[{"user_id":"u1","email":null,"full_name":"Jane","role":"professor","supervisor_id":null}]"#;
    let up = upstream(profile, vec![]).await;
    let (status, _, value) = reply(&up, post(DELETE_OTP, "", Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "Your account has no email address; contact an administrator to delete it."})
    );
    assert!(calls(&up, "POST", OTP).is_empty());
}

#[tokio::test]
async fn otp_is_sent_and_only_a_hint_is_returned() {
    let up = upstream(PROFILE_OK, vec![]).await;
    let (status, _, value) = reply(&up, post(DELETE_OTP, "", Some(SESSION))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true, "emailHint": "ja***@example.com"}));
    let sent = calls(&up, "POST", OTP);
    let body: Value = serde_json::from_slice(&sent.first().expect("otp").body).expect("json");
    assert_eq!(body["email"], json!("jane@example.com"));
}

#[tokio::test]
async fn otp_upstream_refusal_is_500_with_its_message() {
    let up = upstream(
        PROFILE_OK,
        vec![(OTP, vec![json_reply(429, r#"{"msg":"rate"}"#)])],
    )
    .await;
    let (status, _, value) = reply(&up, post(DELETE_OTP, "", Some(SESSION))).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(value, json!({"error": "rate"}));
}

#[tokio::test]
async fn invalid_json_is_400() {
    let up = upstream(PROFILE_OK, vec![]).await;
    let (status, _, value) = reply(&up, post(DELETE_USER, "{not json", Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let message = value["error"].as_str().unwrap_or_default();
    assert!(message.starts_with("Invalid JSON body: "), "{message}");
}

#[tokio::test]
async fn wrong_confirmation_is_400() {
    let up = upstream(PROFILE_OK, vec![]).await;
    let body = r#"{"confirmation":"yes","otp":"123456"}"#;
    let (status, _, value) = reply(&up, post(DELETE_USER, body, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "Type DELETE_USER to confirm account deletion."})
    );
    assert!(calls(&up, "POST", VERIFY).is_empty());
}

#[tokio::test]
async fn blank_otp_is_400() {
    let up = upstream(PROFILE_OK, vec![]).await;
    let body = r#"{"confirmation":"DELETE_USER","otp":"   "}"#;
    let (status, _, value) = reply(&up, post(DELETE_USER, body, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "Enter the confirmation code emailed to you."})
    );
}

#[tokio::test]
async fn unrecognised_otp_is_400() {
    let up = upstream(PROFILE_OK, vec![]).await;
    let body = r#"{"confirmation":"DELETE_USER","otp":"nonsense!"}"#;
    let (status, _, value) = reply(&up, post(DELETE_USER, body, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "Enter the 6-digit code or confirmation link from your email."})
    );
    assert!(calls(&up, "POST", VERIFY).is_empty());
}

#[tokio::test]
async fn code_for_another_account_is_403() {
    let up = upstream(
        PROFILE_OK,
        vec![(VERIFY, vec![json_reply(200, r#"{"id":"u2"}"#)])],
    )
    .await;
    let (status, _, value) = reply(&up, post(DELETE_USER, CONFIRMED, Some(SESSION))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        value,
        json!({"error": "Confirmation code does not match this account."})
    );
    assert!(calls(&up, "DELETE", ADMIN_DELETE).is_empty());
}

#[tokio::test]
async fn expired_code_is_400_and_deletes_nothing() {
    let up = upstream(
        PROFILE_OK,
        vec![(
            VERIFY,
            vec![json_reply(
                403,
                r#"{"msg":"Token has expired or is invalid"}"#,
            )],
        )],
    )
    .await;
    let (status, _, value) = reply(&up, post(DELETE_USER, CONFIRMED, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Token has expired or is invalid"}));
    assert!(calls(&up, "POST", RPC).is_empty());
}

#[tokio::test]
async fn confirmed_code_deletes_the_account() {
    let up = upstream(PROFILE_OK, vec![]).await;
    let (status, _, value) = reply(&up, post(DELETE_USER, CONFIRMED, Some(SESSION))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));

    let rpc = calls(&up, "POST", RPC);
    let rpc_body: Value = serde_json::from_slice(&rpc.first().expect("rpc").body).expect("json");
    assert_eq!(rpc_body, json!({"p_user_id": "u1"}));
    assert_eq!(calls(&up, "DELETE", ADMIN_DELETE).len(), 1);
}

#[tokio::test]
async fn failed_data_delete_keeps_the_auth_account() {
    let up = upstream(
        PROFILE_OK,
        vec![(RPC, vec![json_reply(500, r#"{"message":"boom"}"#)])],
    )
    .await;
    let (status, _, value) = reply(&up, post(DELETE_USER, CONFIRMED, Some(SESSION))).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(value["error"].as_str().is_some_and(|m| !m.is_empty()));
    assert!(calls(&up, "DELETE", ADMIN_DELETE).is_empty());
}

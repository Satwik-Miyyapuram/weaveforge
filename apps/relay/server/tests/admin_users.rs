//! `POST /api/admin/create-user` over the HTTP router, against a stand-in for Supabase.
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
const PROFILES: &str = "/rest/v1/profiles";
const ADMIN_USERS: &str = "/auth/v1/admin/users";
const NEW_USER: &str = "/auth/v1/admin/users/new-1";
const CREATE: &str = "/api/admin/create-user";
const GOOD: &str = r#"{"email":"  New@Example.com ","password":"password1","fullName":"  Jane Doe  ","role":"phd"}"#;

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// The caller's `profiles` row (the caller is `prof-1`) with the given role.
fn caller(role: &str) -> Reply {
    json_reply(
        200,
        &format!(
            r#"[{{"user_id":"prof-1","email":"me@example.com","full_name":null,"role":"{role}","supervisor_id":null}}]"#
        ),
    )
}

/// An upstream where `a.b.c` is `prof-1`. `profiles` answers the profile reads and writes in turn.
async fn upstream(profiles: Vec<Reply>, gotrue: Vec<Reply>) -> Upstream {
    serve(vec![
        (AUTH_USER, vec![json_reply(200, r#"{"id":"prof-1"}"#)]),
        (PROFILES, profiles),
        (ADMIN_USERS, gotrue),
        (NEW_USER, vec![json_reply(200, "{}")]),
    ])
    .await
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

/// A create-user POST with the given `Authorization` header, or none.
fn post(body: &str, authorization: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method("POST").uri(CREATE);
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

/// The requests the upstream saw with `method` on `target`.
fn calls(up: &Upstream, method: &str, target: &str) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.method == method && seen.target == target)
        .collect()
}

#[tokio::test]
async fn no_session_is_401() {
    let up = upstream(vec![], vec![]).await;
    let (status, _, value) = reply(&up, post(GOOD, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(value, json!({"error": "Not authenticated."}));
    assert!(up.seen().iter().all(|seen| seen.target != ADMIN_USERS));
}

#[tokio::test]
async fn profile_read_failure_is_503() {
    let up = upstream(vec![json_reply(500, r#"{"message":"boom"}"#)], vec![]).await;
    let (status, _, value) = reply(&up, post(GOOD, Some(SESSION))).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(value["error"].is_string(), "{value}");
    assert!(calls(&up, "POST", ADMIN_USERS).is_empty());
}

#[tokio::test]
async fn missing_profile_is_403() {
    let up = upstream(vec![json_reply(200, "[]")], vec![]).await;
    let (status, _, value) = reply(&up, post(GOOD, Some(SESSION))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        value,
        json!({"error": "Invalid session or missing member profile."})
    );
}

#[tokio::test]
async fn invalid_json_is_400() {
    let up = upstream(vec![caller("professor")], vec![]).await;
    let (status, _, value) = reply(&up, post("{not json", Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let message = value["error"].as_str().unwrap_or_default();
    assert!(message.starts_with("Invalid JSON body: "), "{message}");
}

#[tokio::test]
async fn non_string_email_is_400() {
    let up = upstream(vec![caller("professor")], vec![]).await;
    let body = r#"{"email":5,"password":"password1","role":"phd"}"#;
    let (status, _, value) = reply(&up, post(body, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Invalid input."}));
}

#[tokio::test]
async fn short_password_is_400() {
    let up = upstream(vec![caller("professor")], vec![]).await;
    let body = r#"{"email":"a@example.com","password":"short","role":"phd"}"#;
    let (status, _, value) = reply(&up, post(body, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "Password must be at least 8 characters."})
    );
    assert!(calls(&up, "POST", ADMIN_USERS).is_empty());
}

#[tokio::test]
async fn missing_role_is_400() {
    let up = upstream(vec![caller("professor")], vec![]).await;
    let body = r#"{"email":"a@example.com","password":"password1"}"#;
    let (status, _, value) = reply(&up, post(body, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Unknown role: undefined"}));
}

#[tokio::test]
async fn masters_cannot_create_masters() {
    let up = upstream(vec![caller("masters")], vec![]).await;
    let body = r#"{"email":"a@example.com","password":"password1","role":"masters"}"#;
    let (status, _, value) = reply(&up, post(body, Some(SESSION))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        value,
        json!({"error": "A masters cannot create a masters account."})
    );
    assert!(calls(&up, "POST", ADMIN_USERS).is_empty());
}

#[tokio::test]
async fn professor_creates_a_phd_under_themselves() {
    let up = upstream(
        vec![
            caller("professor"),
            json_reply(201, r#"[{"user_id":"new-1"}]"#),
        ],
        vec![json_reply(200, r#"{"id":"new-1"}"#)],
    )
    .await;
    let (status, _, value) = reply(&up, post(GOOD, Some(SESSION))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        value,
        json!({"member": {
            "id": "new-1",
            "email": "new@example.com",
            "fullName": "Jane Doe",
            "role": "phd",
            "supervisorId": "prof-1"
        }})
    );

    let created = calls(&up, "POST", ADMIN_USERS);
    let sent: Value =
        serde_json::from_slice(&created.first().expect("admin call").body).expect("json body");
    assert_eq!(sent["email"], json!("new@example.com"));
    assert_eq!(sent["email_confirm"], json!(true));
    assert_eq!(sent["user_metadata"]["full_name"], json!("Jane Doe"));

    let rows = calls(&up, "POST", PROFILES);
    let row: Value =
        serde_json::from_slice(&rows.last().expect("profile write").body).expect("json body");
    assert_eq!(row["user_id"], json!("new-1"));
    assert_eq!(row["email"], json!("new@example.com"));
    assert_eq!(row["full_name"], json!("Jane Doe"));
    assert_eq!(row["role"], json!("phd"));
    assert_eq!(row["supervisor_id"], json!("prof-1"));
    assert!(calls(&up, "DELETE", NEW_USER).is_empty());
}

#[tokio::test]
async fn existing_email_is_409() {
    let up = upstream(
        vec![caller("professor")],
        vec![json_reply(
            422,
            r#"{"msg":"A user with this email address has already been registered"}"#,
        )],
    )
    .await;
    let (status, _, value) = reply(&up, post(GOOD, Some(SESSION))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        value,
        json!({"error": "An account with that email address already exists."})
    );
}

#[tokio::test]
async fn auth_failure_is_502() {
    let up = upstream(
        vec![caller("professor")],
        vec![json_reply(500, r#"{"msg":"boom"}"#)],
    )
    .await;
    let (status, _, value) = reply(&up, post(GOOD, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(value, json!({"error": "Could not create the account."}));
}

#[tokio::test]
async fn profile_write_failure_removes_the_new_user() {
    let up = upstream(
        vec![
            caller("professor"),
            json_reply(500, r#"{"message":"boom"}"#),
        ],
        vec![json_reply(200, r#"{"id":"new-1"}"#)],
    )
    .await;
    let (status, _, value) = reply(&up, post(GOOD, Some(SESSION))).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(value, json!({"error": "Could not create the account."}));
    assert_eq!(calls(&up, "DELETE", NEW_USER).len(), 1);
}

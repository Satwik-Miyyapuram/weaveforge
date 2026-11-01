//! The GoTrue client and caller profile lookup, against a stand-in for Supabase.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use common::{Reply, Upstream, response, serve};
use serde_json::{Value, json};
use wf_core::member::OtpInput;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::gotrue::{
    Member, admin_create_user, admin_delete_user, resolve_member, send_email_otp, session_user_id,
    verify_email_otp,
};
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::AppState;
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const PROFILES: &str = "/rest/v1/profiles";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where the session `a.b.c` is user `u1`, plus the given routes.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"u1"}"#)]));
    serve(routes).await
}

fn state(supabase_port: u16) -> Arc<AppState> {
    let supabase = format!("http://127.0.0.1:{supabase_port}");
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

/// A port with nothing listening on it.
fn closed_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[tokio::test]
async fn session_user_id_reads_the_user_from_a_valid_session() {
    let up = upstream(vec![]).await;
    let state = state(up.port);
    assert_eq!(
        session_user_id(&state, SESSION).await,
        Some("u1".to_string())
    );
    let seen = up.seen();
    assert_eq!(seen[0].header("apikey"), Some("anon"));
    assert_eq!(seen[0].header("authorization"), Some("Bearer a.b.c"));
}

#[tokio::test]
async fn session_user_id_is_none_when_supabase_refuses_the_session() {
    let up = serve(vec![(AUTH_USER, vec![json_reply(401, r#"{"msg":"bad"}"#)])]).await;
    assert_eq!(session_user_id(&state(up.port), SESSION).await, None);
}

#[tokio::test]
async fn resolve_member_is_none_without_a_session() {
    let up = serve(vec![(AUTH_USER, vec![json_reply(401, "{}")])]).await;
    let member = resolve_member(&state(up.port), SESSION).await.unwrap();
    assert_eq!(member, None);
}

#[tokio::test]
async fn resolve_member_reads_the_profile_with_the_service_role() {
    let row = r#"[{"user_id":"u1","email":"a@x.org","full_name":null,"role":"phd","supervisor_id":"p1"}]"#;
    let up = upstream(vec![(PROFILES, vec![json_reply(200, row)])]).await;
    let member = resolve_member(&state(up.port), SESSION)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        member,
        Member {
            id: "u1".to_string(),
            email: Some("a@x.org".to_string()),
            full_name: None,
            role: "phd".to_string(),
            supervisor_id: Some("p1".to_string()),
        }
    );
    let seen = up.seen();
    let profile = seen
        .iter()
        .find(|s| s.target.starts_with(PROFILES))
        .unwrap();
    assert!(profile.target.contains("user_id=eq.u1"));
    assert_eq!(profile.header("apikey"), Some("service"));
}

#[tokio::test]
async fn resolve_member_is_none_without_a_profile_row() {
    let up = upstream(vec![(PROFILES, vec![json_reply(200, "[]")])]).await;
    let member = resolve_member(&state(up.port), SESSION).await.unwrap();
    assert_eq!(member, None);
}

#[tokio::test]
async fn resolve_member_fails_when_the_profile_query_fails() {
    let up = upstream(vec![(
        PROFILES,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    assert!(resolve_member(&state(up.port), SESSION).await.is_err());
}

#[test]
fn member_json_leaves_out_absent_fields() {
    let bare = Member {
        id: "u1".to_string(),
        email: None,
        full_name: None,
        role: "masters".to_string(),
        supervisor_id: None,
    };
    assert_eq!(bare.to_json(), json!({"id": "u1", "role": "masters"}));
    let full = Member {
        id: "u1".to_string(),
        email: Some("a@x.org".to_string()),
        full_name: Some("Ann".to_string()),
        role: "phd".to_string(),
        supervisor_id: Some("p1".to_string()),
    };
    assert_eq!(
        full.to_json(),
        json!({"id": "u1", "email": "a@x.org", "fullName": "Ann", "role": "phd", "supervisorId": "p1"})
    );
}

#[tokio::test]
async fn admin_create_sends_confirmed_email_and_name_only_when_given() {
    let up = serve(vec![(
        "/auth/v1/admin/users",
        vec![json_reply(200, r#"{"id":"new1"}"#)],
    )])
    .await;
    let state = state(up.port);
    let named = admin_create_user(&state, "a@x.org", "pw12345678", Some("Ann")).await;
    assert_eq!(named, Ok("new1".to_string()));
    let unnamed = admin_create_user(&state, "b@x.org", "pw12345678", None).await;
    assert_eq!(unnamed, Ok("new1".to_string()));

    let seen = up.seen();
    let first: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(first["email_confirm"], json!(true));
    assert_eq!(first["user_metadata"], json!({"full_name": "Ann"}));
    assert_eq!(seen[0].header("apikey"), Some("service"));
    let second: Value = serde_json::from_slice(&seen[1].body).unwrap();
    assert!(second.get("user_metadata").is_none());
}

#[tokio::test]
async fn admin_create_reads_the_id_from_a_user_object() {
    let up = serve(vec![(
        "/auth/v1/admin/users",
        vec![json_reply(200, r#"{"user":{"id":"new2"}}"#)],
    )])
    .await;
    let created = admin_create_user(&state(up.port), "a@x.org", "pw12345678", None).await;
    assert_eq!(created, Ok("new2".to_string()));
}

#[tokio::test]
async fn admin_create_returns_the_auth_message_on_refusal() {
    let body = r#"{"msg":"A user with this email address has already been registered"}"#;
    let up = serve(vec![("/auth/v1/admin/users", vec![json_reply(422, body)])]).await;
    let created = admin_create_user(&state(up.port), "a@x.org", "pw12345678", None).await;
    assert_eq!(
        created,
        Err("A user with this email address has already been registered".to_string())
    );
}

#[tokio::test]
async fn admin_delete_succeeds_and_sends_no_soft_delete() {
    let up = serve(vec![(
        "/auth/v1/admin/users/u1",
        vec![json_reply(200, "{}")],
    )])
    .await;
    assert_eq!(admin_delete_user(&state(up.port), "u1").await, Ok(()));
    let seen = up.seen();
    assert_eq!(seen[0].method, "DELETE");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body, json!({"should_soft_delete": false}));
}

#[tokio::test]
async fn admin_delete_returns_the_auth_message_on_failure() {
    let up = serve(vec![(
        "/auth/v1/admin/users/u1",
        vec![json_reply(404, r#"{"msg":"User not found"}"#)],
    )])
    .await;
    let deleted = admin_delete_user(&state(up.port), "u1").await;
    assert_eq!(deleted, Err("User not found".to_string()));
}

#[tokio::test]
async fn send_email_otp_uses_the_anon_key_and_no_signup() {
    let up = serve(vec![("/auth/v1/otp", vec![json_reply(200, "{}")])]).await;
    assert_eq!(send_email_otp(&state(up.port), "a@x.org").await, Ok(()));
    let seen = up.seen();
    assert_eq!(seen[0].header("apikey"), Some("anon"));
    assert_eq!(seen[0].header("authorization"), Some("Bearer anon"));
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body, json!({"email": "a@x.org", "create_user": false}));
}

#[tokio::test]
async fn send_email_otp_returns_the_error_description_on_failure() {
    let up = serve(vec![(
        "/auth/v1/otp",
        vec![json_reply(400, r#"{"error_description":"x"}"#)],
    )])
    .await;
    assert_eq!(
        send_email_otp(&state(up.port), "a@x.org").await,
        Err("x".to_string())
    );
}

#[tokio::test]
async fn verify_with_a_code_sends_the_email_and_token() {
    let up = serve(vec![(
        "/auth/v1/verify",
        vec![json_reply(200, r#"{"user":{"id":"u1"}}"#)],
    )])
    .await;
    let otp = OtpInput::Token("123456".to_string());
    let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
    assert_eq!(verified, Ok("u1".to_string()));
    let body: Value = serde_json::from_slice(&up.seen()[0].body).unwrap();
    assert_eq!(
        body,
        json!({"type": "email", "email": "a@x.org", "token": "123456"})
    );
}

#[tokio::test]
async fn verify_with_a_token_hash_sends_no_email() {
    let up = serve(vec![(
        "/auth/v1/verify",
        vec![json_reply(200, r#"{"id":"u1"}"#)],
    )])
    .await;
    let otp = OtpInput::TokenHash("abc".to_string());
    let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
    assert_eq!(verified, Ok("u1".to_string()));
    let body: Value = serde_json::from_slice(&up.seen()[0].body).unwrap();
    assert_eq!(body, json!({"type": "email", "token_hash": "abc"}));
}

#[tokio::test]
async fn verify_falls_back_to_a_fixed_message_without_one() {
    let up = serve(vec![("/auth/v1/verify", vec![json_reply(403, "{}")])]).await;
    let otp = OtpInput::Token("123456".to_string());
    let verified = verify_email_otp(&state(up.port), "a@x.org", &otp).await;
    assert_eq!(
        verified,
        Err("Invalid or expired confirmation code.".to_string())
    );
}

#[tokio::test]
async fn unreachable_auth_server_is_reported_as_such() {
    let state = state(closed_port());
    assert_eq!(
        send_email_otp(&state, "a@x.org").await,
        Err("Could not reach the auth server.".to_string())
    );
    assert_eq!(
        admin_delete_user(&state, "u1").await,
        Err("Could not reach the auth server.".to_string())
    );
}

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

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
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const PROFILES: &str = "/rest/v1/profiles";
const PROJECTS: &str = "/rest/v1/projects";
const EXPERIMENTS: &str = "/rest/v1/experiments";

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where `a.b.c` is user `user-1`, plus the given REST replies.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = vec![(AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)])];
    routes.extend(rest);
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

/// A request with the session header.
fn request(method: &str, uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", SESSION)
        .body(Body::from(body.to_owned()))
        .expect("request")
}

async fn send(up: &Upstream, request: Request<Body>) -> (StatusCode, Value) {
    let response = app(state(up))
        .oneshot(request)
        .await
        .expect("router is infallible");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    (status, serde_json::from_slice(&bytes).expect("json body"))
}

/// The requests the upstream saw on the REST API (not the user lookup).
fn rest_calls(up: &Upstream) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target.starts_with("/rest/v1/"))
        .collect()
}

fn body_json(seen: &Seen) -> Value {
    serde_json::from_slice(&seen.body).expect("json body")
}

#[tokio::test]
async fn every_route_refuses_a_missing_token_before_anything_else() {
    let up = upstream(vec![]).await;
    let cases = [
        ("GET", "/api/sdk/whoami", ""),
        ("GET", "/api/sdk/projects?name=Thesis", ""),
        ("GET", "/api/sdk/experiments?id=e1", ""),
        ("POST", "/api/sdk/experiments", "not json"),
        ("DELETE", "/api/sdk/experiments?id=e1", ""),
    ];
    for (method, uri, body) in cases {
        let anonymous = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::from(body.to_owned()))
            .expect("request");
        let (status, value) = send(&up, anonymous).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(
            value,
            json!({"error": "Not authenticated."}),
            "{method} {uri}"
        );
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn whoami_returns_the_profile_names() {
    let up = upstream(vec![(
        PROFILES,
        vec![json_reply(
            200,
            r#"[{"email":"ada@example.org","full_name":"Ada"}]"#,
        )],
    )])
    .await;
    let (status, value) = send(&up, request("GET", "/api/sdk/whoami", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({"userId": "user-1", "email": "ada@example.org", "fullName": "Ada"})
    );
    assert!(rest_calls(&up)[0].target.contains("user_id=eq.user-1"));
}

#[tokio::test]
async fn whoami_with_a_profile_error_answers_null_names() {
    let up = upstream(vec![(
        PROFILES,
        vec![json_reply(403, r#"{"code":"42501","message":"denied"}"#)],
    )])
    .await;
    let (status, value) = send(&up, request("GET", "/api/sdk/whoami", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({"userId": "user-1", "email": null, "fullName": null})
    );
}

#[tokio::test]
async fn projects_without_a_name_is_400() {
    let up = upstream(vec![]).await;
    for uri in ["/api/sdk/projects", "/api/sdk/projects?name=%20"] {
        let (status, value) = send(&up, request("GET", uri, "")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(value, json!({"error": "Missing project name."}), "{uri}");
    }
}

#[tokio::test]
async fn projects_returns_the_matching_id() {
    let up = upstream(vec![(
        PROJECTS,
        vec![json_reply(200, r#"[{"id":"p1","name":"Thesis"}]"#)],
    )])
    .await;
    let (status, value) = send(&up, request("GET", "/api/sdk/projects?name=Thesis", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"projectId": "p1"}));
    let target = &rest_calls(&up)[0].target;
    assert!(target.contains("name=eq.Thesis"));
    assert!(target.contains("limit=1"));
}

#[tokio::test]
async fn projects_with_no_match_answers_null() {
    let up = upstream(vec![(PROJECTS, vec![json_reply(200, "[]")])]).await;
    let (status, value) = send(&up, request("GET", "/api/sdk/projects?name=Thesis", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"projectId": null}));
}

#[tokio::test]
async fn projects_database_error_is_500_with_safe_wording() {
    let up = upstream(vec![(
        PROJECTS,
        vec![json_reply(
            403,
            r#"{"code":"42501","message":"permission denied for table projects"}"#,
        )],
    )])
    .await;
    let (status, value) = send(&up, request("GET", "/api/sdk/projects?name=Thesis", "")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        value,
        json!({"error": "You do not have permission to do that. (42501)"})
    );
}

#[tokio::test]
async fn experiments_get_without_an_id_is_400() {
    let up = upstream(vec![]).await;
    let (status, value) = send(&up, request("GET", "/api/sdk/experiments", "")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Missing experiment id."}));
}

#[tokio::test]
async fn experiments_get_returns_the_row() {
    let up = upstream(vec![(
        EXPERIMENTS,
        vec![json_reply(200, r#"[{"id":"e1","name":"Run"}]"#)],
    )])
    .await;
    let (status, value) = send(&up, request("GET", "/api/sdk/experiments?id=e1", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"experiment": {"id": "e1", "name": "Run"}}));
    let target = &rest_calls(&up)[0].target;
    assert!(target.contains("id=eq.e1"));
    assert!(target.contains("limit=1"));
}

#[tokio::test]
async fn experiments_get_with_no_row_answers_null() {
    let up = upstream(vec![(EXPERIMENTS, vec![json_reply(200, "[]")])]).await;
    let (status, value) = send(&up, request("GET", "/api/sdk/experiments?id=e1", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"experiment": null}));
}

#[tokio::test]
async fn experiments_post_rejects_a_body_that_is_not_an_object_or_array() {
    let up = upstream(vec![]).await;
    for body in ["not json", "null", "\"text\""] {
        let (status, value) = send(&up, request("POST", "/api/sdk/experiments", body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(value, json!({"error": "Invalid JSON body."}), "{body}");
    }
}

#[tokio::test]
async fn experiments_post_without_an_id_is_400() {
    let up = upstream(vec![]).await;
    let (status, value) = send(
        &up,
        request("POST", "/api/sdk/experiments", r#"{"name":"Run"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value, json!({"error": "Experiment must include id."}));
}

#[tokio::test]
async fn experiments_post_falls_back_to_the_stored_name() {
    let stored = json_reply(200, r#"[{"id":"e1","name":"Old"}]"#);
    let up = upstream(vec![(EXPERIMENTS, vec![stored.clone(), stored])]).await;
    let (status, value) = send(
        &up,
        request("POST", "/api/sdk/experiments", r#"{"id":" e1 "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"experiment": {"id": "e1", "name": "Old"}}));
    let calls = rest_calls(&up);
    assert_eq!(calls[1].method, "POST");
    assert_eq!(
        body_json(&calls[1]),
        json!({"id": "e1", "name": "Old", "user_id": "user-1"})
    );
}

#[tokio::test]
async fn experiments_post_strips_bookkeeping_columns_and_sets_the_owner() {
    let up = upstream(vec![(
        EXPERIMENTS,
        vec![
            json_reply(200, "[]"),
            json_reply(200, r#"[{"id":"e1","name":"Run"}]"#),
        ],
    )])
    .await;
    let body = r#"{"id":"e1","name":" Run ","user_id":"evil","created_at":"x",
        "row_version":3,"server_seq":4,"deleted_at":"y","status":"running"}"#;
    let (status, _) = send(&up, request("POST", "/api/sdk/experiments", body)).await;
    assert_eq!(status, StatusCode::OK);
    let calls = rest_calls(&up);
    assert_eq!(
        body_json(&calls[1]),
        json!({"id": "e1", "name": "Run", "user_id": "user-1", "status": "running"})
    );
}

#[tokio::test]
async fn experiments_post_without_any_name_is_400() {
    let up = upstream(vec![(EXPERIMENTS, vec![json_reply(200, "[]")])]).await;
    let (status, value) = send(
        &up,
        request("POST", "/api/sdk/experiments", r#"{"id":"e1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        value,
        json!({"error": "Experiment must include id and name."})
    );
}

#[tokio::test]
async fn experiments_delete_of_a_missing_row_is_404() {
    let up = upstream(vec![(
        EXPERIMENTS,
        vec![response(200, &[("Content-Range", "*/0")], b"")],
    )])
    .await;
    let (status, value) = send(&up, request("DELETE", "/api/sdk/experiments?id=e1", "")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(value, json!({"error": "Experiment not found."}));
    let call = &rest_calls(&up)[0];
    assert_eq!(call.method, "DELETE");
    assert!(call.target.contains("id=eq.e1"));
}

#[tokio::test]
async fn experiments_delete_of_an_existing_row_is_ok() {
    let up = upstream(vec![(
        EXPERIMENTS,
        vec![response(200, &[("Content-Range", "*/1")], b"")],
    )])
    .await;
    let (status, value) = send(&up, request("DELETE", "/api/sdk/experiments?id=e1", "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));
}

//! Overleaf report routes over the HTTP router: `/api/overleaf/reports`.
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
const REPORTS: &str = "/rest/v1/overleaf_linked_reports";
const PROJECTS: &str = "/rest/v1/projects";
const CONNECTIONS: &str = "/rest/v1/overleaf_connections";
const PATH: &str = "/api/overleaf/reports";

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

/// A request to `uri` with the session header.
fn request(method: &str, uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", SESSION)
        .body(Body::from(body.to_owned()))
        .expect("request")
}

/// Sends `req` through the router; returns status, headers and the JSON body.
async fn call(up: &Upstream, req: Request<Body>) -> (StatusCode, HeaderMap, Value) {
    let response = app(state(up))
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

fn error_of(value: &Value) -> &str {
    value["error"].as_str().unwrap_or("")
}

/// A valid create body, with `overrides` merged over it.
fn create_body(overrides: &Value) -> String {
    let mut body = json!({
        "projectId": "p1",
        "connectionId": "c1",
        "title": " Thesis ",
        "overleafProjectId": "abc123"
    });
    if let (Some(base), Some(extra)) = (body.as_object_mut(), overrides.as_object()) {
        for (key, value) in extra {
            let _old = base.insert(key.clone(), value.clone());
        }
    }
    body.to_string()
}

/// Upstream routes where the caller owns project `p1` and connection `c1`.
fn owned() -> Vec<(&'static str, Vec<Reply>)> {
    vec![
        (PROJECTS, vec![json_reply(200, r#"[{"id":"p1"}]"#)]),
        (CONNECTIONS, vec![json_reply(200, r#"[{"id":"c1"}]"#)]),
    ]
}

#[tokio::test]
async fn get_without_auth_is_401_and_reads_nothing() {
    let up = upstream(vec![]).await;
    let req = Request::builder()
        .method("GET")
        .uri(PATH)
        .body(Body::empty())
        .expect("request");
    let (status, _, body) = call(&up, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&body), "Not authenticated.");
    assert!(calls(&up, REPORTS).is_empty());
}

#[tokio::test]
async fn get_maps_rows_no_store_with_order_and_select() {
    let up = upstream(vec![(REPORTS, vec![json_reply(200, r#"[{"id":"r1"}]"#)])]).await;
    let (status, headers, body) = call(&up, request("GET", PATH, "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"reports": [{"id": "r1"}]}));
    assert_eq!(headers.get("cache-control").unwrap(), "no-store");
    let seen = calls(&up, REPORTS);
    assert_eq!(seen.len(), 1);
    assert!(seen[0].target.contains("order=updated_at.desc"));
    assert!(seen[0].target.contains("select="));
    assert!(!seen[0].target.contains("project_id="));
}

#[tokio::test]
async fn get_filters_by_project_id() {
    let up = upstream(vec![(REPORTS, vec![json_reply(200, "[]")])]).await;
    let (status, _, _) = call(&up, request("GET", &format!("{PATH}?projectId=p9"), "")).await;
    assert_eq!(status, StatusCode::OK);
    let seen = calls(&up, REPORTS);
    assert!(seen[0].target.contains("project_id=eq.p9"));
}

#[tokio::test]
async fn get_database_failure_is_500() {
    let up = upstream(vec![(
        REPORTS,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    let (status, _, _) = call(&up, request("GET", PATH, "")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn post_invalid_json_is_400() {
    let up = upstream(vec![]).await;
    let (status, _, body) = call(&up, request("POST", PATH, "{bad")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error_of(&body).starts_with("Invalid JSON body: "));
}

#[tokio::test]
async fn post_non_object_is_400() {
    let up = upstream(vec![]).await;
    let (status, _, body) = call(&up, request("POST", PATH, "[1]")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&body), "Request body must be a JSON object.");
}

#[tokio::test]
async fn post_null_field_is_not_a_string() {
    let up = upstream(vec![]).await;
    let body = create_body(&json!({"projectId": null}));
    let (status, _, value) = call(&up, request("POST", PATH, &body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "projectId must be a string.");
}

#[tokio::test]
async fn post_first_non_string_field_in_order_wins() {
    let up = upstream(vec![]).await;
    let body = create_body(&json!({"title": 5, "projectId": 3}));
    let (_, _, value) = call(&up, request("POST", PATH, &body)).await;
    assert_eq!(error_of(&value), "projectId must be a string.");
    let body = create_body(&json!({"entryFile": 5, "title": 3}));
    let (_, _, value) = call(&up, request("POST", PATH, &body)).await;
    assert_eq!(error_of(&value), "title must be a string.");
}

#[tokio::test]
async fn post_blank_required_field_is_400() {
    let up = upstream(vec![]).await;
    let body = create_body(&json!({"title": "   "}));
    let (status, _, value) = call(&up, request("POST", PATH, &body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        error_of(&value),
        "Project, connection, title, and Overleaf project id are required."
    );
}

#[tokio::test]
async fn post_invalid_project_id_is_400() {
    let up = upstream(vec![]).await;
    let body = create_body(&json!({"overleafProjectId": "bad id!"}));
    let (status, _, value) = call(&up, request("POST", PATH, &body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "Overleaf project id is invalid.");
}

#[tokio::test]
async fn post_invalid_entry_file_is_400() {
    let up = upstream(vec![]).await;
    let body = create_body(&json!({"entryFile": "../x.tex"}));
    let (status, _, value) = call(&up, request("POST", PATH, &body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "Entry file path is invalid.");
}

#[tokio::test]
async fn post_unowned_project_or_connection_is_404() {
    let up = upstream(vec![
        (PROJECTS, vec![json_reply(200, "[]")]),
        (CONNECTIONS, vec![json_reply(200, r#"[{"id":"c1"}]"#)]),
    ])
    .await;
    let (status, _, value) = call(&up, request("POST", PATH, &create_body(&json!({})))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        error_of(&value),
        "Project or Overleaf connection not found."
    );
    assert!(calls(&up, REPORTS).is_empty());
}

#[tokio::test]
async fn post_unowned_connection_is_404() {
    let up = upstream(vec![
        (PROJECTS, vec![json_reply(200, r#"[{"id":"p1"}]"#)]),
        (CONNECTIONS, vec![json_reply(200, "[]")]),
    ])
    .await;
    let (status, _, _) = call(&up, request("POST", PATH, &create_body(&json!({})))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn post_database_failure_is_500() {
    let up = upstream(vec![(
        PROJECTS,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    let (status, _, _) = call(&up, request("POST", PATH, &create_body(&json!({})))).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn post_inserts_row_with_external_url_and_default_entry() {
    let mut routes = owned();
    routes.push((REPORTS, vec![json_reply(201, r#"[{"id":"r1"}]"#)]));
    let up = upstream(routes).await;
    let (status, _, value) = call(&up, request("POST", PATH, &create_body(&json!({})))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(value, json!({"report": {"id": "r1"}}));
    let seen = calls(&up, REPORTS);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert_eq!(
        body_json(&seen[0]),
        json!({
            "user_id": "user-1",
            "project_id": "p1",
            "connection_id": "c1",
            "title": "Thesis",
            "overleaf_project_id": "abc123",
            "entry_file": "main.tex",
            "external_url": "https://www.overleaf.com/project/abc123"
        })
    );
}

#[tokio::test]
async fn post_keeps_trimmed_entry_file() {
    let mut routes = owned();
    routes.push((REPORTS, vec![json_reply(201, "[]")]));
    let up = upstream(routes).await;
    let body = create_body(&json!({"entryFile": "  paper/main.tex "}));
    let (status, _, value) = call(&up, request("POST", PATH, &body)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(value, json!({"report": null}));
    let seen = calls(&up, REPORTS);
    assert_eq!(body_json(&seen[0])["entry_file"], "paper/main.tex");
}

#[tokio::test]
async fn patch_without_id_is_400() {
    let up = upstream(vec![]).await;
    let (status, _, value) = call(&up, request("PATCH", PATH, r#"{"title":"x"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "Report id required.");
}

#[tokio::test]
async fn patch_non_string_field_is_400() {
    let up = upstream(vec![]).await;
    let body = r#"{"id":"r1","title":5}"#;
    let (status, _, value) = call(&up, request("PATCH", PATH, body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "title must be a string.");
}

#[tokio::test]
async fn patch_non_object_is_400() {
    let up = upstream(vec![]).await;
    let (status, _, value) = call(&up, request("PATCH", PATH, "\"r1\"")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "Request body must be a JSON object.");
}

#[tokio::test]
async fn patch_blank_title_is_400() {
    let up = upstream(vec![]).await;
    let (status, _, value) = call(&up, request("PATCH", PATH, r#"{"id":"r1","title":"  "}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "Title cannot be empty.");
}

#[tokio::test]
async fn patch_blank_overleaf_project_id_is_400() {
    let up = upstream(vec![]).await;
    let body = r#"{"id":"r1","overleafProjectId":" "}"#;
    let (_, _, value) = call(&up, request("PATCH", PATH, body)).await;
    assert_eq!(error_of(&value), "Overleaf project id cannot be empty.");
}

#[tokio::test]
async fn patch_invalid_overleaf_project_id_is_400() {
    let up = upstream(vec![]).await;
    let body = r#"{"id":"r1","overleafProjectId":"a b"}"#;
    let (_, _, value) = call(&up, request("PATCH", PATH, body)).await;
    assert_eq!(error_of(&value), "Overleaf project id is invalid.");
}

#[tokio::test]
async fn patch_invalid_entry_file_is_400() {
    let up = upstream(vec![]).await;
    let body = r#"{"id":"r1","entryFile":"/etc/x.tex"}"#;
    let (_, _, value) = call(&up, request("PATCH", PATH, body)).await;
    assert_eq!(error_of(&value), "Entry file path is invalid.");
}

#[tokio::test]
async fn patch_invalid_section_targets_is_400() {
    let up = upstream(vec![]).await;
    for body in [
        r#"{"id":"r1","sectionTargets":{"":1}}"#,
        r#"{"id":"r1","sectionTargets":null}"#,
    ] {
        let (status, _, value) = call(&up, request("PATCH", PATH, body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(error_of(&value), "Section targets are invalid.");
    }
}

#[tokio::test]
async fn patch_with_nothing_to_update_is_400() {
    let up = upstream(vec![]).await;
    let (status, _, value) = call(&up, request("PATCH", PATH, r#"{"id":"r1"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "Nothing to update.");
}

#[tokio::test]
async fn patch_title_leaves_last_error_alone() {
    let up = upstream(vec![(REPORTS, vec![json_reply(200, r#"[{"id":"r1"}]"#)])]).await;
    let (status, _, _) = call(
        &up,
        request("PATCH", PATH, r#"{"id":"r1","title":" New "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let seen = calls(&up, REPORTS);
    assert_eq!(seen[0].method, "PATCH");
    assert_eq!(body_json(&seen[0]), json!({"title": "New"}));
    assert!(seen[0].target.contains("id=eq.r1"));
    assert!(seen[0].target.contains("user_id=eq.user-1"));
}

#[tokio::test]
async fn patch_entry_file_resets_last_error_and_defaults_blank() {
    let up = upstream(vec![(REPORTS, vec![json_reply(200, r#"[{"id":"r1"}]"#)])]).await;
    let (status, _, _) = call(&up, request("PATCH", PATH, r#"{"id":"r1","entryFile":""}"#)).await;
    assert_eq!(status, StatusCode::OK);
    let seen = calls(&up, REPORTS);
    assert_eq!(
        body_json(&seen[0]),
        json!({"entry_file": "main.tex", "last_error": null})
    );
}

#[tokio::test]
async fn patch_overleaf_project_id_sets_url_and_resets_last_error() {
    let up = upstream(vec![(REPORTS, vec![json_reply(200, r#"[{"id":"r1"}]"#)])]).await;
    let body = r#"{"id":"r1","overleafProjectId":" abc "}"#;
    let (status, _, _) = call(&up, request("PATCH", PATH, body)).await;
    assert_eq!(status, StatusCode::OK);
    let seen = calls(&up, REPORTS);
    assert_eq!(
        body_json(&seen[0]),
        json!({
            "overleaf_project_id": "abc",
            "external_url": "https://www.overleaf.com/project/abc",
            "last_error": null
        })
    );
}

#[tokio::test]
async fn patch_section_targets_are_sanitized() {
    let up = upstream(vec![(REPORTS, vec![json_reply(200, r#"[{"id":"r1"}]"#)])]).await;
    let body = r#"{"id":"r1","sectionTargets":{"Intro":2.0,"Methods":null}}"#;
    let (status, _, _) = call(&up, request("PATCH", PATH, body)).await;
    assert_eq!(status, StatusCode::OK);
    let seen = calls(&up, REPORTS);
    assert_eq!(
        body_json(&seen[0]),
        json!({"section_targets": {"Intro": 2}})
    );
}

#[tokio::test]
async fn patch_returns_row_and_404_without_one() {
    let up = upstream(vec![(
        REPORTS,
        vec![json_reply(200, r#"[{"id":"r1","title":"New"}]"#)],
    )])
    .await;
    let (status, _, value) =
        call(&up, request("PATCH", PATH, r#"{"id":"r1","title":"New"}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"report": {"id": "r1", "title": "New"}}));

    let up = upstream(vec![(REPORTS, vec![json_reply(200, "[]")])]).await;
    let (status, _, value) =
        call(&up, request("PATCH", PATH, r#"{"id":"r1","title":"New"}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_of(&value), "Report not found.");
}

#[tokio::test]
async fn delete_without_id_is_400() {
    let up = upstream(vec![]).await;
    let (status, _, value) = call(&up, request("DELETE", PATH, "")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_of(&value), "Report id required.");
}

#[tokio::test]
async fn delete_with_zero_count_is_404() {
    let none = response(200, &[("Content-Range", "*/0")], b"");
    let up = upstream(vec![(REPORTS, vec![none])]).await;
    let (status, _, value) = call(&up, request("DELETE", &format!("{PATH}?id=r1"), "")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_of(&value), "Report not found.");
}

#[tokio::test]
async fn delete_removes_owned_row() {
    let one = response(200, &[("Content-Range", "*/1")], b"");
    let up = upstream(vec![(REPORTS, vec![one])]).await;
    let (status, _, value) = call(&up, request("DELETE", &format!("{PATH}?id=r1"), "")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value, json!({"ok": true}));
    let seen = calls(&up, REPORTS);
    assert_eq!(seen[0].method, "DELETE");
    assert!(seen[0].target.contains("id=eq.r1"));
    assert!(seen[0].target.contains("user_id=eq.user-1"));
}

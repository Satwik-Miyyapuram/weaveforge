//! The plan feed route (`/api/plan/feed/{token}/{file}`) over the HTTP router.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::Value;
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

/// `tt_` plus 43 base64url characters, the shape of an API token.
const TOKEN: &str = "tt_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const AUTH_USER: &str = "/auth/v1/user";
const SCOPES: &str = "/rest/v1/rpc/api_token_scopes";
const RESOLVE: &str = "/rest/v1/rpc/resolve_plan_feed_token";
const MILESTONES: &str = "/rest/v1/milestones";
const PROJECTS: &str = "/rest/v1/projects";
const NOT_FOUND: &str = r#"{"error":"Not found."}"#;

const LIVE: &str = r#"{"id":"m1","title":"Chapter draft","description":null,"status":"planned","target_date":"2099-03-01","dependencies":[],"compute":[],"created_at":"2026-01-01T00:00:00.000Z","project_id":"p1"}"#;
const ORPHAN: &str = r#"{"id":"m2","title":"Orphan task","description":null,"status":"planned","target_date":"2099-03-02","dependencies":null,"compute":null,"created_at":"2026-01-01T00:00:00.000Z","project_id":"gone"}"#;
const FINISHED: &str = r#"{"id":"m3","title":"Finished item","description":null,"status":"done","target_date":"2099-01-05","dependencies":[],"compute":[],"created_at":"2026-01-01T00:00:00.000Z","project_id":null}"#;

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where the token is a `plan_feed` token for `user-1`, with the given milestone rows.
async fn upstream(milestones: &str) -> Upstream {
    serve(vec![
        (SCOPES, vec![json_reply(200, r#"["plan_feed"]"#)]),
        (RESOLVE, vec![json_reply(200, r#""user-1""#)]),
        (AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]),
        (
            MILESTONES,
            vec![json_reply(200, &format!("[{milestones}]"))],
        ),
        (
            PROJECTS,
            vec![json_reply(200, r#"[{"id":"p1","name":"Thesis"}]"#)],
        ),
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

/// Sends a GET through the router; returns status, headers and the body text.
async fn get(up: &Upstream, uri: &str) -> (StatusCode, HeaderMap, String) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .body(Body::empty())
        .expect("request");
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
        String::from_utf8(bytes.to_vec()).expect("utf-8"),
    )
}

/// The requests the upstream saw whose target starts with `prefix`, in order.
fn calls(up: &Upstream, prefix: &str) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target.starts_with(prefix))
        .collect()
}

fn link(file: &str) -> String {
    format!("/api/plan/feed/{TOKEN}/{file}")
}

#[tokio::test]
async fn unknown_file_is_404_before_any_auth() {
    let up = upstream(LIVE).await;
    let (status, _, body) = get(&up, &link("secret.txt")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, NOT_FOUND);
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn non_token_is_404_without_upstream_calls() {
    let up = upstream(LIVE).await;
    let (status, _, body) = get(&up, "/api/plan/feed/not-a-token/deadlines.ics").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, NOT_FOUND);
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn sdk_scoped_token_is_404_and_never_resolved() {
    let up = serve(vec![
        (SCOPES, vec![json_reply(200, r#"["sdk"]"#)]),
        (RESOLVE, vec![json_reply(200, r#""user-1""#)]),
        (AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]),
    ])
    .await;
    let (status, _, body) = get(&up, &link("deadlines.ics")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, NOT_FOUND);
    assert!(calls(&up, RESOLVE).is_empty());
}

#[tokio::test]
async fn deadlines_ics_lists_live_milestones_only() {
    let up = upstream(&format!("{LIVE},{ORPHAN}")).await;
    let (status, headers, body) = get(&up, &link("deadlines.ics")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("BEGIN:VCALENDAR"), "{body}");
    assert!(body.contains("BEGIN:VEVENT"), "{body}");
    assert!(body.contains("Chapter draft"), "{body}");
    assert!(!body.contains("Orphan task"), "{body}");

    assert_eq!(
        headers.get("content-type").unwrap(),
        "text/calendar; charset=utf-8"
    );
    assert_eq!(
        headers.get("cache-control").unwrap(),
        "private, max-age=300"
    );
    assert_eq!(headers.get("referrer-policy").unwrap(), "no-referrer");
    assert_eq!(headers.get("x-robots-tag").unwrap(), "noindex");
    assert_eq!(
        headers.get("content-disposition").unwrap(),
        "inline; filename=\"weaveforge-deadlines.ics\""
    );
}

#[tokio::test]
async fn milestone_query_is_scoped_to_the_owner_and_live_rows() {
    let up = upstream(LIVE).await;
    let (status, _, _) = get(&up, &link("deadlines.ics")).await;
    assert_eq!(status, StatusCode::OK);

    let sent = calls(&up, MILESTONES);
    let first = sent.first().expect("milestones select");
    assert!(
        first.target.contains("user_id=eq.user-1"),
        "{}",
        first.target
    );
    assert!(
        first.target.contains("deleted_at=is.null"),
        "{}",
        first.target
    );
    assert!(first.target.contains("project_id"), "{}", first.target);
    assert!(
        first
            .header("authorization")
            .is_some_and(|value| value.starts_with("Bearer ")),
        "caller's JWT is sent"
    );
}

#[tokio::test]
async fn done_milestones_only_with_done_flag() {
    let up = upstream(&format!("{LIVE},{FINISHED}")).await;
    let (_, _, hidden) = get(&up, &link("deadlines.ics")).await;
    assert!(!hidden.contains("Finished item"), "{hidden}");

    let (status, _, shown) = get(&up, &link("deadlines.ics?done=1")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(shown.contains("Finished item"), "{shown}");
}

#[tokio::test]
async fn alarm_adds_a_reminder_to_the_calendar() {
    let up = upstream(LIVE).await;
    let (_, _, plain) = get(&up, &link("deadlines.ics")).await;
    assert!(!plain.contains("BEGIN:VALARM"), "{plain}");

    let (status, _, alarmed) = get(&up, &link("deadlines.ics?alarm=3")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(alarmed.contains("BEGIN:VALARM"), "{alarmed}");
}

#[tokio::test]
async fn widget_json_has_cors_and_the_milestone() {
    let up = upstream(&format!("{LIVE},{ORPHAN}")).await;
    let (status, headers, body) = get(&up, &link("widget.json")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        headers.get("content-type").unwrap(),
        "application/json; charset=utf-8"
    );
    assert_eq!(headers.get("access-control-allow-origin").unwrap(), "*");
    assert_eq!(headers.get("x-robots-tag").unwrap(), "noindex");
    assert!(headers.get("content-disposition").is_none());

    let value: Value = serde_json::from_str(&body).expect("json");
    assert_eq!(value["items"][0]["title"], "Chapter draft");
    assert_eq!(value["items"][0]["project"], "Thesis");
    assert!(!body.contains("Orphan task"), "{body}");
}

#[tokio::test]
async fn milestone_select_failure_is_500() {
    let up = serve(vec![
        (SCOPES, vec![json_reply(200, r#"["plan_feed"]"#)]),
        (RESOLVE, vec![json_reply(200, r#""user-1""#)]),
        (AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]),
        (
            MILESTONES,
            vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
        ),
        (PROJECTS, vec![json_reply(200, "[]")]),
    ])
    .await;
    let (status, _, body) = get(&up, &link("deadlines.ics")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    let value: Value = serde_json::from_str(&body).expect("json");
    assert!(value.get("error").is_some(), "{body}");
}

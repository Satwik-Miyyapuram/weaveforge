//! `POST /api/report-issue` over the HTTP router, against a stand-in for the issue tracker.
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
const REPORT: &str = "/api/report-issue";
const ISSUES: &str = "/repos/acme/bugs/issues";
const CREATED: &str = r#"{"html_url":"https://github.com/acme/bugs/issues/7","number":7}"#;
const GOOD: &str = r#"{"title":"Crash on open","detail":"Mail jane@example.com about it"}"#;

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// An upstream where `a.b.c` is `user`. The given routes are the tracker's replies.
async fn upstream(user: &str, rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((
        AUTH_USER,
        vec![json_reply(200, &format!(r#"{{"id":"{user}"}}"#))],
    ));
    serve(routes).await
}

/// Settings that file to `up` with `token`; no token means reporting is off.
fn settings(up: &Upstream, token: Option<&str>) -> SettingsConfig {
    SettingsConfig {
        issues_token: token.map(str::to_owned),
        issues_repo: "acme/bugs".to_owned(),
        issues_api: up.base.as_str().trim_end_matches('/').to_owned(),
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

/// A report POST with the given `Authorization` header, or none.
fn post(body: &str, authorization: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method("POST").uri(REPORT);
    if let Some(value) = authorization {
        builder = builder.header("authorization", value);
    }
    builder.body(Body::from(body.to_owned())).expect("request")
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

/// The requests the tracker saw for an issue (not the session check).
fn issue_calls(up: &Upstream) -> Vec<Seen> {
    up.seen()
        .into_iter()
        .filter(|seen| seen.target == ISSUES)
        .collect()
}

#[tokio::test]
async fn no_session_is_refused() {
    let up = upstream("rep-anon", vec![]).await;
    let (status, _, value) = reply(&up, settings(&up, Some("gh")), post(GOOD, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(value, json!({"error": "Not authenticated."}));
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn blank_title_or_description_is_400() {
    let up = upstream("rep-blank", vec![]).await;
    let bodies = [
        r#"{"title":"  ","detail":"x"}"#,
        r#"{"title":"x"}"#,
        r#"{"title":"x","detail":5}"#,
    ];
    for body in bodies {
        let req = post(body, Some(SESSION));
        let (status, _, value) = reply(&up, settings(&up, Some("gh")), req).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(
            value,
            json!({"error": "A title and a description are required."}),
            "{body}"
        );
    }
    assert!(issue_calls(&up).is_empty());
}

#[tokio::test]
async fn invalid_json_is_400() {
    let up = upstream("rep-json", vec![]).await;
    let req = post("{not json", Some(SESSION));
    let (status, _, value) = reply(&up, settings(&up, Some("gh")), req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let message = value["error"].as_str().unwrap_or_default();
    assert!(message.starts_with("Invalid JSON body: "), "{message}");
}

#[tokio::test]
async fn missing_token_is_503() {
    let up = upstream("rep-503", vec![]).await;
    let req = post(GOOD, Some(SESSION));
    let (status, _, value) = reply(&up, settings(&up, None), req).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        value,
        json!({"error": "Report filing is not configured on this deployment (GITHUB_ISSUES_TOKEN)."})
    );
    assert!(issue_calls(&up).is_empty());
}

#[tokio::test]
async fn files_a_redacted_issue_with_the_tracker_headers() {
    let up = upstream("rep-ok", vec![(ISSUES, vec![json_reply(201, CREATED)])]).await;
    let req = post(GOOD, Some(SESSION));
    let (status, _, value) = reply(&up, settings(&up, Some("gh")), req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value,
        json!({"ok": true, "url": "https://github.com/acme/bugs/issues/7", "number": 7})
    );

    let sent = issue_calls(&up);
    let filed = sent.first().expect("issue");
    assert_eq!(filed.method, "POST");
    assert_eq!(filed.header("authorization"), Some("Bearer gh"));
    assert_eq!(filed.header("accept"), Some("application/vnd.github+json"));
    assert_eq!(filed.header("user-agent"), Some("weaveforge-error-report"));
    let issue: Value = serde_json::from_slice(&filed.body).expect("json body");
    assert_eq!(issue["title"], json!("[app] Crash on open"));
    let markdown = issue["body"].as_str().unwrap_or_default();
    assert!(markdown.contains("Mail <email> about it"), "{markdown}");
    assert!(!markdown.contains("jane@example.com"), "{markdown}");
    assert!(
        markdown.ends_with("1 item(s) were redacted automatically."),
        "{markdown}"
    );
}

#[tokio::test]
async fn tracker_refusal_is_502() {
    let up = upstream(
        "rep-422",
        vec![(
            ISSUES,
            vec![json_reply(422, r#"{"message":"Validation Failed"}"#)],
        )],
    )
    .await;
    let req = post(GOOD, Some(SESSION));
    let (status, _, value) = reply(&up, settings(&up, Some("gh")), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(
        value,
        json!({"error": "The issue tracker refused the report."})
    );
}

#[tokio::test]
async fn non_json_tracker_reply_is_502() {
    let up = upstream("rep-html", vec![(ISSUES, vec![json_reply(201, "<html>")])]).await;
    let req = post(GOOD, Some(SESSION));
    let (status, _, value) = reply(&up, settings(&up, Some("gh")), req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(
        value,
        json!({"error": "The issue tracker could not be reached."})
    );
}

#[tokio::test]
async fn unreachable_tracker_is_502() {
    let up = upstream("rep-down", vec![]).await;
    let mut config = settings(&up, Some("gh"));
    config.issues_api = "http://127.0.0.1:1".to_owned();
    let req = post(GOOD, Some(SESSION));
    let (status, _, value) = reply(&up, config, req).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(
        value,
        json!({"error": "The issue tracker could not be reached."})
    );
}

#[tokio::test]
async fn sixth_report_in_a_row_is_429_with_retry_after() {
    let up = upstream("rep-burst", vec![(ISSUES, vec![json_reply(201, CREATED)])]).await;
    for _ in 0..5 {
        let req = post(GOOD, Some(SESSION));
        let (status, _, _) = reply(&up, settings(&up, Some("gh")), req).await;
        assert_eq!(status, StatusCode::OK);
    }
    let req = post(GOOD, Some(SESSION));
    let (status, headers, value) = reply(&up, settings(&up, Some("gh")), req).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        value,
        json!({"error": "Too many reports just now. Try again later."})
    );
    let retry = headers
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    assert!(retry.is_some_and(|secs| secs > 0), "{headers:?}");
    assert_eq!(issue_calls(&up).len(), 5);
}

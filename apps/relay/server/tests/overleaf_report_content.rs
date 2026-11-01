//! The Overleaf report content route over the HTTP router: `/api/overleaf/reports/{id}/content`.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use serde_json::{Value, json};
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::credential_crypto::{MISSING_KEY, seal};
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

const SESSION: &str = "Bearer a.b.c";
const AUTH_USER: &str = "/auth/v1/user";
const REPORTS: &str = "/rest/v1/overleaf_linked_reports";
const CONNECTIONS: &str = "/rest/v1/overleaf_connections";
const PATH: &str = "/api/overleaf/reports/r1/content";
const KEY: &str = "test-key";
/// The linked-report row for project `project`.
fn report_row(project: &str) -> String {
    format!(
        r#"[{{"id":"r1","overleaf_project_id":"{project}","entry_file":"main.tex","external_url":null,"connection_id":"c1"}}]"#
    )
}

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

/// The reply for an empty PATCH (`return=minimal`).
fn patch_reply() -> Reply {
    json_reply(204, "")
}

/// An upstream where `a.b.c` is user `user-1`. The given routes win over the default.
async fn upstream(rest: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let mut routes = rest;
    routes.push((AUTH_USER, vec![json_reply(200, r#"{"id":"user-1"}"#)]));
    serve(routes).await
}

/// Settings with the credential key `key` and the git base `base`.
fn settings(key: Option<&str>, base: &str) -> SettingsConfig {
    SettingsConfig {
        credential_key: key.map(str::to_owned),
        overleaf_git_base: base.to_owned(),
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

/// A GET to the content route, with the session header.
fn request() -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(PATH)
        .header("authorization", SESSION)
        .body(Body::empty())
        .expect("request")
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

/// The `PATCH` requests the upstream saw on the reports table.
fn patches(up: &Upstream) -> Vec<Seen> {
    calls(up, REPORTS)
        .into_iter()
        .filter(|seen| seen.method == "PATCH")
        .collect()
}

fn body_json(seen: &Seen) -> Value {
    serde_json::from_slice(&seen.body).expect("json body")
}

fn error_of(value: &Value) -> &str {
    value["error"].as_str().unwrap_or("")
}

/// Upstream routes where the report `r1` exists and connection `c1` holds `tok` sealed with `key`.
/// The first report reply is the GET; the PATCH that follows gets `patch_reply`.
fn linked(key: &str, project: &str) -> Vec<(&'static str, Vec<Reply>)> {
    let sealed = seal("tok", Some(key)).expect("seal");
    vec![
        (
            REPORTS,
            vec![json_reply(200, &report_row(project)), patch_reply()],
        ),
        (
            CONNECTIONS,
            vec![json_reply(
                200,
                &json!([{"token_ciphertext": sealed}]).to_string(),
            )],
        ),
    ]
}

/// A fresh directory for one test, empty.
fn fresh_dir(tag: &str) -> PathBuf {
    let root =
        std::env::temp_dir().join(format!("wf-overleaf-content-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("create dir");
    root
}

/// Runs `git` with `args` in `dir`; fails the test when it does not succeed.
fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

/// A repo `proj-{tag}` under a fresh parent dir with `main.tex`; returns the parent.
fn make_repo(tag: &str) -> PathBuf {
    let parent = fresh_dir(tag);
    let repo = parent.join(format!("proj-{tag}"));
    std::fs::create_dir_all(&repo).expect("repo dir");
    std::fs::write(repo.join("main.tex"), "\\section{Intro}\nHello").expect("write");
    git(&repo, &["init", "-q"]);
    git(&repo, &["add", "-A"]);
    git(
        &repo,
        &[
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "-m",
            "init",
        ],
    );
    parent
}

/// The git base for `parent`: forward slashes, as the settings carry it.
fn base_of(parent: &Path) -> String {
    parent.to_string_lossy().replace('\\', "/")
}

#[tokio::test]
async fn get_without_auth_is_401_and_reads_nothing() {
    let up = upstream(vec![]).await;
    let req = Request::builder()
        .method("GET")
        .uri(PATH)
        .body(Body::empty())
        .expect("request");
    let (status, _, body) = call(&up, settings(Some(KEY), "https://git.overleaf.com"), req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_of(&body), "Not authenticated.");
    assert!(calls(&up, REPORTS).is_empty());
}

#[tokio::test]
async fn missing_report_is_404() {
    let up = upstream(vec![(REPORTS, vec![json_reply(200, "[]")])]).await;
    let (status, _, body) = call(
        &up,
        settings(Some(KEY), "https://git.overleaf.com"),
        request(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_of(&body), "Linked Overleaf report not found.");
}

#[tokio::test]
async fn missing_connection_is_404() {
    let up = upstream(vec![
        (REPORTS, vec![json_reply(200, &report_row("PROJ"))]),
        (CONNECTIONS, vec![json_reply(200, "[]")]),
    ])
    .await;
    let (status, _, body) = call(
        &up,
        settings(Some(KEY), "https://git.overleaf.com"),
        request(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_of(&body), "Overleaf connection is unavailable.");
}

#[tokio::test]
async fn report_select_failure_is_500() {
    let up = upstream(vec![(
        REPORTS,
        vec![json_reply(500, r#"{"message":"boom"}"#)],
    )])
    .await;
    let (status, _, _) = call(
        &up,
        settings(Some(KEY), "https://git.overleaf.com"),
        request(),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn missing_credential_key_is_502_and_records_error() {
    let up = upstream(linked(KEY, "PROJ")).await;
    let (status, headers, body) =
        call(&up, settings(None, "https://git.overleaf.com"), request()).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(error_of(&body), MISSING_KEY);
    let sent = patches(&up);
    assert_eq!(sent.len(), 1);
    assert_eq!(body_json(&sent[0])["last_error"], MISSING_KEY);
}

#[tokio::test]
async fn clone_failure_is_502_without_the_token() {
    let base = fresh_dir("clone-fail");
    let up = upstream(linked(KEY, "PROJ")).await;
    let (status, headers, body) = call(&up, settings(Some(KEY), &base_of(&base)), request()).await;
    let _ = std::fs::remove_dir_all(&base);
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(headers["cache-control"], "no-store");
    let message = error_of(&body);
    assert!(
        message.starts_with("Overleaf git clone failed:"),
        "{message}"
    );
    assert!(!message.contains("tok"), "{message}");
    let sent = patches(&up);
    assert_eq!(sent.len(), 1);
    assert!(body_json(&sent[0])["last_error"].is_string());
}

#[tokio::test]
async fn success_returns_sources_and_records_fetch() {
    let parent = make_repo("success");
    let up = upstream(linked(KEY, "proj-success")).await;
    let (status, headers, body) =
        call(&up, settings(Some(KEY), &base_of(&parent)), request()).await;
    let _ = std::fs::remove_dir_all(&parent);
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(body["reportId"], "r1");
    assert_eq!(body["projectId"], "proj-success");
    assert_eq!(body["entryFile"], "main.tex");
    assert_eq!(body["files"][0]["path"], "main.tex");
    assert_eq!(body["sectionTree"]["roots"][0]["title"], "Intro");
    let sent = patches(&up);
    assert_eq!(sent.len(), 1);
    let patch = body_json(&sent[0]);
    assert!(patch.get("last_fetched_at").is_some_and(Value::is_string));
    assert_eq!(patch["last_error"], Value::Null);
}

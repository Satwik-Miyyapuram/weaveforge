//! The plan feed route (`/api/plan/feed/{token}/{file}`) over the HTTP router.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use common::{Reply, Seen, Upstream, response, serve};
use proptest::prelude::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use wf_core::bytea::{decode_bytea, encode_bytea};
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::settings::SettingsConfig;
use wf_relay_server::storage::StorageConfig;
use wf_relay_server::url_meta::MetaUpstreams;

/// A legacy (pre-`wff_`) API token: `tt_` plus 43 base64url characters.
const TOKEN: &str = "tt_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const AUTH_USER: &str = "/auth/v1/user";
const MILESTONES: &str = "/rest/v1/milestones";
const PROJECTS: &str = "/rest/v1/projects";
const NOT_FOUND: &str = r#"{"error":"Not found."}"#;
/// A `wff_` feed token: the prefix plus 43 base64url characters.
const FEED_TOKEN: &str = "wff_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
/// The token a feed was rotated away from.
const OLD_FEED_TOKEN: &str = "wff_ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlkji";
const SHARED_DOCS: &str = "/rest/v1/shared_docs";
const PUBLISH: &str = "/api/plan/feed/publish";
const SESSION: &str = "Bearer a.b.c";
const FEED_ID: &str = "feed-1";
const FEED_JSON: &str = r#"{"items":[{"id":"m1","title":"Chapter draft","status":"planned","targetDate":"2099-03-01","projectName":"Thesis"}]}"#;

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
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
    send(up, "GET", uri, None, "").await
}

/// Sends one request through the router, with an optional `Authorization` value and a body.
async fn send(
    up: &Upstream,
    method: &str,
    uri: &str,
    authorization: Option<&str>,
    body: &str,
) -> (StatusCode, HeaderMap, String) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(value) = authorization {
        builder = builder.header("authorization", value);
    }
    let req = builder.body(Body::from(body.to_owned())).expect("request");
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
    format!("/api/plan/feed/{FEED_TOKEN}/{file}")
}

/// An upstream holding one published feed whose document is `json`.
async fn published(json: &str) -> Upstream {
    serve(vec![(SHARED_DOCS, vec![json_reply(200, &feed_row(json))])]).await
}

#[tokio::test]
async fn unknown_file_is_404_before_any_lookup() {
    let up = published(FEED_JSON).await;
    let (status, _, body) = get(&up, &link("secret.txt")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, NOT_FOUND);
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn non_feed_tokens_are_410_without_upstream_calls() {
    let up = published(FEED_JSON).await;
    for token in [TOKEN, "not-a-token", "wff_short"] {
        for file in ["deadlines.ics", "widget.json"] {
            let (status, _, body) = get(&up, &feed_link(token, file)).await;
            assert_eq!(status, StatusCode::GONE, "{token} {file}");
            assert_eq!(
                body,
                r#"{"error":"This feature moved to your workspace files."}"#
            );
        }
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn deadlines_ics_has_calendar_headers() {
    let up = published(FEED_JSON).await;
    let (status, headers, body) = get(&up, &link("deadlines.ics")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("BEGIN:VCALENDAR"), "{body}");
    assert!(body.contains("BEGIN:VEVENT"), "{body}");
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
async fn done_items_only_with_done_flag() {
    let up = published(
        r#"{"items":[{"id":"m1","title":"Chapter draft","status":"planned","targetDate":"2099-03-01"},{"id":"m3","title":"Finished item","status":"done","targetDate":"2099-01-05"}]}"#,
    )
    .await;
    let (_, _, hidden) = get(&up, &link("deadlines.ics")).await;
    assert!(hidden.contains("Chapter draft"), "{hidden}");
    assert!(!hidden.contains("Finished item"), "{hidden}");

    let (status, _, shown) = get(&up, &link("deadlines.ics?done=1")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(shown.contains("Finished item"), "{shown}");
}

#[tokio::test]
async fn alarm_adds_a_reminder_to_the_calendar() {
    let up = published(FEED_JSON).await;
    let (_, _, plain) = get(&up, &link("deadlines.ics")).await;
    assert!(!plain.contains("BEGIN:VALARM"), "{plain}");

    let (status, _, alarmed) = get(&up, &link("deadlines.ics?alarm=3")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(alarmed.contains("BEGIN:VALARM"), "{alarmed}");
}

#[tokio::test]
async fn feed_lookup_failure_is_500() {
    let up = serve(vec![(
        SHARED_DOCS,
        vec![json_reply(500, r#"{"code":"XX000","message":"boom"}"#)],
    )])
    .await;
    let (status, _, body) = get(&up, &link("deadlines.ics")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    let value: Value = serde_json::from_str(&body).expect("json");
    assert!(value.get("error").is_some(), "{body}");
}

/// SHA-256 of the token as lower-case hex, the form `shared_docs.feed_token_hash` holds.
fn hash_hex(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// A feed link for `file`.
fn feed_link(token: &str, file: &str) -> String {
    format!("/api/plan/feed/{token}/{file}")
}

/// One `shared_docs` row whose `state` is `json`, as PostgREST returns bytea.
fn feed_row(json: &str) -> String {
    serde_json::json!([{ "state": encode_bytea(json.as_bytes()) }]).to_string()
}

/// A publish body for `token` with `items` as a JSON array.
fn publish_body(token: &str, items: &str) -> String {
    format!(r#"{{"feed_id":"{FEED_ID}","token":"{token}","items":{items}}}"#)
}

const ONE_ITEM: &str =
    r#"[{"id":"m1","title":"Chapter draft","status":"planned","targetDate":"2099-03-01"}]"#;

#[tokio::test]
async fn never_published_404() {
    let up = serve(vec![(SHARED_DOCS, vec![json_reply(200, "[]")])]).await;
    let (status, _, body) = get(&up, &feed_link(FEED_TOKEN, "deadlines.ics")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, NOT_FOUND);
    assert!(calls(&up, MILESTONES).is_empty());
    assert!(calls(&up, PROJECTS).is_empty());
}

#[tokio::test]
async fn token_rotated_old_url_404() {
    let up = serve(vec![(SHARED_DOCS, vec![json_reply(200, "[]")])]).await;
    let (status, _, body) = get(&up, &feed_link(OLD_FEED_TOKEN, "deadlines.ics")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, NOT_FOUND);
    let sent = calls(&up, SHARED_DOCS);
    assert_eq!(sent.len(), 1);
    assert!(sent[0].target.contains(&hash_hex(OLD_FEED_TOKEN)));
    assert!(!sent[0].target.contains(OLD_FEED_TOKEN));
}

#[tokio::test]
async fn feed_served_with_desktop_off() {
    let up = serve(vec![(
        SHARED_DOCS,
        vec![json_reply(200, &feed_row(FEED_JSON))],
    )])
    .await;
    let (status, _, body) = get(&up, &feed_link(FEED_TOKEN, "deadlines.ics")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("DTSTART;VALUE=DATE:20990301"), "{body}");
    assert!(body.contains("UID:m1@weaveforge.org"), "{body}");
    assert!(body.contains("Chapter draft"), "{body}");
    assert!(
        calls(&up, MILESTONES).is_empty(),
        "no live milestones query"
    );
    assert!(calls(&up, PROJECTS).is_empty(), "no live projects query");
}

#[tokio::test]
async fn widget_from_published_feed() {
    let up = serve(vec![(
        SHARED_DOCS,
        vec![json_reply(200, &feed_row(FEED_JSON))],
    )])
    .await;
    let (status, headers, body) = get(&up, &feed_link(FEED_TOKEN, "widget.json")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(headers.get("access-control-allow-origin").unwrap(), "*");
    let value: Value = serde_json::from_str(&body).expect("json");
    assert_eq!(value["items"][0]["title"], "Chapter draft");
    assert_eq!(value["items"][0]["project"], "Thesis");
}

#[tokio::test]
async fn undecodable_state_is_500() {
    let row = serde_json::json!([{ "state": "\\x7b6e6f74" }]).to_string();
    let up = serve(vec![(SHARED_DOCS, vec![json_reply(200, &row)])]).await;
    let (status, _, body) = get(&up, &feed_link(FEED_TOKEN, "deadlines.ics")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
}

#[tokio::test]
async fn publish_requires_session() {
    let up = serve(vec![(AUTH_USER, vec![json_reply(200, r#"{"id":"u1"}"#)])]).await;
    let body = publish_body(FEED_TOKEN, ONE_ITEM);
    let (status, _, _) = send(&up, "POST", PUBLISH, None, &body).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(calls(&up, SHARED_DOCS).is_empty());
}

#[tokio::test]
async fn publish_bad_token_400() {
    let up = serve(vec![(AUTH_USER, vec![json_reply(200, r#"{"id":"u1"}"#)])]).await;
    let short = publish_body("wff_short", ONE_ITEM);
    let (status, _, _) = send(&up, "POST", PUBLISH, Some(SESSION), &short).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let legacy = publish_body("tt_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG", ONE_ITEM);
    let (status, _, _) = send(&up, "POST", PUBLISH, Some(SESSION), &legacy).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let bad_id = format!(r#"{{"feed_id":"bad id!","token":"{FEED_TOKEN}","items":{ONE_ITEM}}}"#);
    let (status, _, _) = send(&up, "POST", PUBLISH, Some(SESSION), &bad_id).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(calls(&up, SHARED_DOCS).is_empty());
}

/// Asserts publish wrote with two statements that each check on their own:
/// an insert that never replaces a row, then an update filtered by owner.
/// No owner is read first, so no other publish can slip in between.
fn assert_conditional_writes(sent: &[Seen]) {
    assert_eq!(
        sent.len(),
        2,
        "insert-if-absent, then owner-filtered update"
    );
    let insert = &sent[0];
    assert_eq!(insert.method, "POST");
    assert!(
        insert.target.contains("on_conflict=item_id"),
        "{}",
        insert.target
    );
    assert!(
        insert
            .header("prefer")
            .is_some_and(|prefer| prefer.contains("resolution=ignore-duplicates")),
        "the insert never replaces another owner's row"
    );
    let update = &sent[1];
    assert_eq!(update.method, "PATCH");
    assert!(
        update.target.contains("item_id=eq.feed-1"),
        "{}",
        update.target
    );
    assert!(update.target.contains("owner=eq.u1"), "{}", update.target);
    assert!(
        sent.iter().all(|seen| seen.method != "GET"),
        "no owner select"
    );
}

#[tokio::test]
async fn publish_refuses_other_owner_403() {
    let up = serve(vec![
        (AUTH_USER, vec![json_reply(200, r#"{"id":"u1"}"#)]),
        (
            SHARED_DOCS,
            // The insert is skipped (u2 owns the row); the owner-filtered update matches nothing.
            vec![json_reply(201, ""), json_reply(200, "[]")],
        ),
    ])
    .await;
    let body = publish_body(FEED_TOKEN, ONE_ITEM);
    let (status, _, reply) = send(&up, "POST", PUBLISH, Some(SESSION), &body).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(reply, r#"{"error":"Not your feed."}"#);
    assert_conditional_writes(&calls(&up, SHARED_DOCS));
}

#[tokio::test]
async fn publish_sends_hash_not_token() {
    let up = serve(vec![
        (AUTH_USER, vec![json_reply(200, r#"{"id":"u1"}"#)]),
        (
            SHARED_DOCS,
            vec![
                json_reply(201, ""),
                json_reply(200, r#"[{"item_id":"feed-1"}]"#),
            ],
        ),
    ])
    .await;
    let body = publish_body(FEED_TOKEN, ONE_ITEM);
    let (status, _, reply) = send(&up, "POST", PUBLISH, Some(SESSION), &body).await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply, r#"{"ok":true}"#);

    let sent = calls(&up, SHARED_DOCS);
    assert_conditional_writes(&sent);
    let row: Value = serde_json::from_slice(&sent[0].body).expect("json");
    assert_eq!(row["item_id"], FEED_ID);
    assert_eq!(row["owner"], "u1");
    let patch: Value = serde_json::from_slice(&sent[1].body).expect("json");
    assert!(
        patch.get("owner").is_none(),
        "the update never changes the owner"
    );
    for written in [&row, &patch] {
        assert_eq!(written["kind"], "feed");
        assert_eq!(written["feed_token_hash"], hash_hex(FEED_TOKEN));
        let state = written["state"].as_str().expect("state");
        let stored: Value = serde_json::from_slice(&decode_bytea(state)).expect("json");
        assert_eq!(stored["items"][0]["title"], "Chapter draft");
    }

    for seen in up.seen() {
        assert!(!seen.target.contains(FEED_TOKEN), "{}", seen.target);
        let sent_body = String::from_utf8_lossy(&seen.body);
        assert!(!sent_body.contains(FEED_TOKEN), "{}", seen.target);
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(12))]

    /// For any valid `wff_` token, the upstream lookup names its hash and never the token.
    #[test]
    fn upstream_query_names_hash_never_token(token in "wff_[A-Za-z0-9_-]{32,64}") {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let up = serve(vec![(SHARED_DOCS, vec![json_reply(200, "[]")])]).await;
            let (status, _, _) = get(&up, &feed_link(&token, "deadlines.ics")).await;
            assert_eq!(status, StatusCode::NOT_FOUND);
            let sent = calls(&up, SHARED_DOCS);
            assert_eq!(sent.len(), 1);
            assert!(sent[0].target.contains(&hash_hex(&token)), "{}", sent[0].target);
            assert!(!sent[0].target.contains(&token), "{}", sent[0].target);
        });
    }
}

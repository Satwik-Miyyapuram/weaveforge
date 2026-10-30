//! Tests for the Zotero desktop local API relay (ported from apps/desktop/test/zotero-local.test.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "common/upstream.rs"]
mod upstream;

use std::collections::BTreeMap;
use std::net::TcpListener;
use std::time::Duration;

use upstream::{redirect, response, serve};
use weaveforge_shell::zotero_local::{
    LOCAL_ORIGIN, MAX_ZOTERO_BODY, NOT_ANSWERING, NOT_LOCAL, TOO_LARGE, ZOTERO_LOCAL_API,
    ZOTERO_LOCAL_LIBRARY, ZOTERO_LOCAL_TIMEOUT, fetch_zotero_at, is_local_zotero_url,
    is_zotero_url_at,
};

const SHORT: Duration = Duration::from_secs(5);

fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

#[test]
fn constants() {
    assert_eq!(LOCAL_ORIGIN, "http://127.0.0.1:23119");
    assert_eq!(ZOTERO_LOCAL_API, "http://127.0.0.1:23119/api");
    assert_eq!(ZOTERO_LOCAL_LIBRARY, "users/0");
    assert_eq!(ZOTERO_LOCAL_TIMEOUT, Duration::from_secs(20));
    assert_eq!(MAX_ZOTERO_BODY, 64 * 1024 * 1024);
    assert_eq!(
        NOT_LOCAL,
        "Only the Zotero API on this computer can be read here."
    );
    assert_eq!(
        NOT_ANSWERING,
        "Zotero on this computer did not answer. Is it running?"
    );
    assert_eq!(TOO_LARGE, "Zotero's answer was too large to read.");
}

#[test]
fn local_url_cases() {
    let yes = [
        "http://127.0.0.1:23119/api",
        "http://127.0.0.1:23119/api/",
        "http://127.0.0.1:23119/api/users/0/items?limit=5",
        "http://127.0.0.1:23119/api/users/0/items",
    ];
    let no = [
        "http://127.0.0.1:23119/apix",
        "http://127.0.0.1:23119/apifoo",
        "http://127.0.0.1:23119/",
        "http://127.0.0.1:23119/connector/ping",
        "http://localhost:23119/api",
        "http://localhost:23119/api/items",
        "https://127.0.0.1:23119/api",
        "https://127.0.0.1:23119/api/items",
        "http://127.0.0.1:23120/api",
        "http://127.0.0.1:5432/api/items",
        "http://u:p@127.0.0.1:23119/api",
        "http://u@127.0.0.1:23119/api",
        "http://user:pw@127.0.0.1:23119/api/items",
        "http://evil.example/api/items",
        "not a url",
        "",
    ];
    for url in yes {
        assert!(is_zotero_url_at(url, LOCAL_ORIGIN), "{url}");
        assert!(is_local_zotero_url(url), "{url}");
    }
    for url in no {
        assert!(!is_zotero_url_at(url, LOCAL_ORIGIN), "{url}");
        assert!(!is_local_zotero_url(url), "{url}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refuses_before_fetching() {
    let up = serve(vec![("/other", vec![response(200, &[], b"x")])]).await;
    let err = fetch_zotero_at(up.url("/other").as_str(), up.base.as_str(), SHORT)
        .await
        .unwrap_err();
    assert_eq!(err, NOT_LOCAL);
    assert!(up.seen().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn relays_status_body_and_kept_headers() {
    let up = serve(vec![(
        "/api/items",
        vec![response(
            200,
            &[
                ("Total-Results", "7"),
                ("Backoff", "5"),
                ("X-Other", "y"),
                ("Content-Type", "application/json"),
            ],
            b"[1]",
        )],
    )])
    .await;
    let reply = fetch_zotero_at(up.url("/api/items").as_str(), up.base.as_str(), SHORT)
        .await
        .unwrap();
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, "[1]");
    assert_eq!(
        reply.headers,
        map(&[
            ("total-results", "7"),
            ("backoff", "5"),
            ("content-type", "application/json"),
        ])
    );
    let seen = up.seen();
    assert_eq!(
        seen.first().and_then(|s| s.header("zotero-api-version")),
        Some("3")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn non_2xx_is_relayed() {
    let up = serve(vec![("/api/x", vec![response(404, &[], b"nope")])]).await;
    let reply = fetch_zotero_at(up.url("/api/x").as_str(), up.base.as_str(), SHORT)
        .await
        .unwrap();
    assert_eq!(reply.status, 404);
    assert_eq!(reply.body, "nope");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_header_skipped() {
    let up = serve(vec![(
        "/api/x",
        vec![response(200, &[("Retry-After", "")], b"[]")],
    )])
    .await;
    let reply = fetch_zotero_at(up.url("/api/x").as_str(), up.base.as_str(), SHORT)
        .await
        .unwrap();
    assert!(!reply.headers.contains_key("retry-after"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn redirect_is_error() {
    let up = serve(vec![("/api/items", vec![redirect("/api/x")])]).await;
    let err = fetch_zotero_at(up.url("/api/items").as_str(), up.base.as_str(), SHORT)
        .await
        .unwrap_err();
    assert_eq!(err, NOT_ANSWERING);
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bom_dropped() {
    let up = serve(vec![(
        "/api/x",
        vec![response(200, &[], b"\xEF\xBB\xBF{}")],
    )])
    .await;
    let reply = fetch_zotero_at(up.url("/api/x").as_str(), up.base.as_str(), SHORT)
        .await
        .unwrap();
    assert_eq!(reply.body, "{}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nothing_listening() {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let origin = format!("http://127.0.0.1:{port}");
    let raw = format!("{origin}/api");
    let err = fetch_zotero_at(&raw, &origin, SHORT).await.unwrap_err();
    assert_eq!(err, NOT_ANSWERING);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repeated_header_joined_and_latin1() {
    let up = serve(vec![(
        "/api/x",
        vec![response(
            200,
            &[("Backoff", "5"), ("Backoff", "6"), ("Content-Type", "é")],
            b"[]",
        )],
    )])
    .await;
    let reply = fetch_zotero_at(up.url("/api/x").as_str(), up.base.as_str(), SHORT)
        .await
        .unwrap();
    assert_eq!(
        reply.headers.get("backoff").map(String::as_str),
        Some("5, 6")
    );
    // UTF-8 bytes read one per char, as a fetch Headers object does.
    assert_eq!(
        reply.headers.get("content-type").map(String::as_str),
        Some("\u{c3}\u{a9}")
    );
}

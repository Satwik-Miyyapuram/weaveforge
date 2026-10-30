//! Tests for the arXiv relay (ported from apps/desktop/src/arxiv-proxy.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "common/upstream.rs"]
mod upstream;

use std::time::{Duration, Instant};

use reqwest::Url;
use reqwest::header::{HeaderMap, HeaderValue};
use weaveforge_shell::relay::arxiv::{
    ARXIV_PROXY_PATH, encode_uri_component, is_arxiv_proxy_request, proxy_arxiv,
};
use weaveforge_shell::relay::shared::{Answer, RelayRequest, relay_client};

use upstream::{Reply, redirect, response, serve};

const PAGE: &str = "app://weaveforge/api/arxiv";
const UA: &str = "weaveforge (mailto:noreply@example.com)";

fn page_request(method: &str, query: &[(&str, &str)], headers: HeaderMap) -> RelayRequest {
    RelayRequest {
        method: method.to_string(),
        url: Url::parse_with_params(PAGE, query).unwrap(),
        headers,
        body: Vec::new(),
    }
}

fn text(answer: &Answer) -> String {
    String::from_utf8_lossy(&answer.body).to_string()
}

fn assert_refused(answer: &Answer, status: u16, error: &str) {
    assert_eq!(answer.status, status);
    assert_eq!(answer.header("content-type"), Some("application/json"));
    assert_eq!(text(answer), format!(r#"{{"error":"{error}"}}"#));
}

#[test]
fn proxy_path_matches_only_the_arxiv_path() {
    assert_eq!(ARXIV_PROXY_PATH, "/api/arxiv");
    assert!(is_arxiv_proxy_request(
        &Url::parse("app://weaveforge/api/arxiv?id_list=1").unwrap()
    ));
    assert!(!is_arxiv_proxy_request(
        &Url::parse("app://weaveforge/api/arxiv/x").unwrap()
    ));
    assert!(!is_arxiv_proxy_request(
        &Url::parse("app://weaveforge/api/other").unwrap()
    ));
}

#[test]
fn encode_uri_component_matches_js() {
    assert_eq!(
        encode_uri_component("2101.00001,2101.00002"),
        "2101.00001%2C2101.00002"
    );
    assert_eq!(encode_uri_component("a b"), "a%20b");
    assert_eq!(encode_uri_component("A-Z_.!~*'()"), "A-Z_.!~*'()");
    assert_eq!(encode_uri_component("é"), "%C3%A9");
    assert_eq!(encode_uri_component("😀"), "%F0%9F%98%80");
    assert_eq!(encode_uri_component("&=?#/+"), "%26%3D%3F%23%2F%2B");
    assert_eq!(encode_uri_component(""), "");
}

#[tokio::test(flavor = "multi_thread")]
async fn refusals() {
    let client = relay_client().unwrap();
    let served = serve(vec![("/api/query", vec![response(200, &[], b"ok")])]).await;
    let upstream = "http://127.0.0.1:9/api/query";
    let timeout = Duration::from_secs(5);
    let good = format!("http://127.0.0.1:{}/api/query", served.port);
    let none = HeaderMap::new();

    for method in ["POST", "post"] {
        let answer = proxy_arxiv(
            &client,
            &page_request(method, &[("id_list", "1")], none.clone()),
            upstream,
            timeout,
        )
        .await;
        assert_refused(&answer, 405, "Method not allowed");
    }

    let answer = proxy_arxiv(
        &client,
        &page_request("GET", &[], none.clone()),
        upstream,
        timeout,
    )
    .await;
    assert_refused(&answer, 400, "id_list is required");

    let answer = proxy_arxiv(
        &client,
        &page_request("GET", &[("id_list", "")], none.clone()),
        upstream,
        timeout,
    )
    .await;
    assert_refused(&answer, 400, "id_list is required");

    let long = "a".repeat(4000);
    let answer = proxy_arxiv(
        &client,
        &page_request("GET", &[("id_list", &long)], none.clone()),
        &good,
        timeout,
    )
    .await;
    assert_eq!(answer.status, 200);

    let too_long = "a".repeat(4001);
    let answer = proxy_arxiv(
        &client,
        &page_request("GET", &[("id_list", &too_long)], none.clone()),
        upstream,
        timeout,
    )
    .await;
    assert_refused(&answer, 400, "id_list must be at most 4000 characters.");

    let emoji_ok = "😀".repeat(2000);
    let answer = proxy_arxiv(
        &client,
        &page_request("GET", &[("id_list", &emoji_ok)], none.clone()),
        &good,
        timeout,
    )
    .await;
    assert_eq!(answer.status, 200);

    let emoji_long = "😀".repeat(2001);
    let answer = proxy_arxiv(
        &client,
        &page_request("GET", &[("id_list", &emoji_long)], none),
        upstream,
        timeout,
    )
    .await;
    assert_refused(&answer, 400, "id_list must be at most 4000 characters.");
}

#[tokio::test(flavor = "multi_thread")]
async fn relays_atom_verbatim() {
    let up = serve(vec![(
        "/api/query",
        vec![response(
            200,
            &[("content-type", "application/atom+xml")],
            b"<feed/>",
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let answer = proxy_arxiv(
        &client,
        &page_request(
            "GET",
            &[("id_list", "2101.00001,2101.00002")],
            HeaderMap::new(),
        ),
        &format!("http://127.0.0.1:{}/api/query", up.port),
        Duration::from_secs(5),
    )
    .await;

    assert_eq!(answer.status, 200);
    assert_eq!(
        answer.headers,
        vec![
            (
                "content-type".to_string(),
                "application/atom+xml".to_string()
            ),
            ("x-content-type-options".to_string(), "nosniff".to_string()),
        ]
    );
    assert_eq!(answer.body, b"<feed/>".to_vec());

    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "GET");
    assert_eq!(seen[0].target, "/api/query?id_list=2101.00001%2C2101.00002");
    assert_eq!(seen[0].header("user-agent"), Some(UA));
}

#[tokio::test(flavor = "multi_thread")]
async fn only_id_list_travels() {
    let up = serve(vec![("/api/query", vec![response(200, &[], b"ok")])]).await;
    let mut headers = HeaderMap::new();
    let _ = headers.insert("cookie", HeaderValue::from_static("a=b"));
    let _ = headers.insert("authorization", HeaderValue::from_static("x"));
    let answer = proxy_arxiv(
        &relay_client().unwrap(),
        &page_request(
            "GET",
            &[
                ("id_list", "1"),
                ("search_query", "x"),
                ("max_results", "999"),
            ],
            headers,
        ),
        &format!("http://127.0.0.1:{}/api/query", up.port),
        Duration::from_secs(5),
    )
    .await;

    assert_eq!(answer.status, 200);
    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].target, "/api/query?id_list=1");
    assert_eq!(seen[0].header("cookie"), None);
    assert_eq!(seen[0].header("authorization"), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_content_type_defaults() {
    let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\n<feed/>".to_vec();
    let up = serve(vec![("/api/query", vec![Reply::Raw(raw)])]).await;
    let answer = proxy_arxiv(
        &relay_client().unwrap(),
        &page_request("GET", &[("id_list", "1")], HeaderMap::new()),
        &format!("http://127.0.0.1:{}/api/query", up.port),
        Duration::from_secs(5),
    )
    .await;

    assert_eq!(answer.status, 200);
    assert_eq!(
        answer.header("content-type"),
        Some("application/atom+xml; charset=utf-8")
    );
    assert_eq!(answer.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(answer.body, b"<feed/>".to_vec());
}

#[tokio::test(flavor = "multi_thread")]
async fn upstream_503_is_502() {
    let up = serve(vec![("/api/query", vec![response(503, &[], b"busy")])]).await;
    let answer = proxy_arxiv(
        &relay_client().unwrap(),
        &page_request("GET", &[("id_list", "1")], HeaderMap::new()),
        &format!("http://127.0.0.1:{}/api/query", up.port),
        Duration::from_secs(5),
    )
    .await;
    assert_refused(&answer, 502, "arXiv responded 503");
}

#[tokio::test(flavor = "multi_thread")]
async fn redirect_is_not_followed() {
    let up = serve(vec![
        ("/api/query", vec![redirect("/elsewhere")]),
        ("/elsewhere", vec![response(200, &[], b"ok")]),
    ])
    .await;
    let answer = proxy_arxiv(
        &relay_client().unwrap(),
        &page_request("GET", &[("id_list", "1")], HeaderMap::new()),
        &format!("http://127.0.0.1:{}/api/query", up.port),
        Duration::from_secs(5),
    )
    .await;

    assert_refused(&answer, 502, "Upstream fetch failed");
    assert!(up.seen().iter().all(|s| s.target != "/elsewhere"));
}

#[tokio::test(flavor = "multi_thread")]
async fn silent_upstream_times_out() {
    let up = serve(vec![("/api/query", vec![Reply::Silent])]).await;
    let started = Instant::now();
    let answer = proxy_arxiv(
        &relay_client().unwrap(),
        &page_request("GET", &[("id_list", "1")], HeaderMap::new()),
        &format!("http://127.0.0.1:{}/api/query", up.port),
        Duration::from_millis(300),
    )
    .await;

    assert_refused(&answer, 502, "Upstream fetch failed");
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_is_502() {
    let answer = proxy_arxiv(
        &relay_client().unwrap(),
        &page_request("GET", &[("id_list", "1")], HeaderMap::new()),
        "http://127.0.0.1:9/api/query",
        Duration::from_secs(5),
    )
    .await;
    assert_refused(&answer, 502, "Upstream fetch failed");
}

//! Tests for the Semantic Scholar relay (ported from semantic-scholar-proxy.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "common/upstream.rs"]
mod upstream;

use std::time::{Duration, Instant};

use reqwest::Url;
use reqwest::header::{HeaderMap, HeaderValue};
use upstream::{Reply, redirect, response};
use weaveforge_shell::relay::semantic_scholar::{
    forwarded_headers, is_semantic_scholar_proxy_request, proxy_semantic_scholar,
    semantic_scholar_target,
};
use weaveforge_shell::relay::shared::{Answer, RelayRequest, relay_client};

const UPSTREAM: &str = "https://api.semanticscholar.org";

fn request(method: &str, path: &str, headers: HeaderMap, body: &[u8]) -> RelayRequest {
    RelayRequest {
        method: method.to_string(),
        url: Url::parse(&format!("app://weaveforge{path}")).unwrap(),
        headers,
        body: body.to_vec(),
    }
}

fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
    list.iter()
        .map(|(n, v)| (n.to_string(), v.to_string()))
        .collect()
}

fn base(upstream: &upstream::Upstream) -> String {
    upstream.base.as_str().trim_end_matches('/').to_string()
}

#[test]
fn target_rules() {
    assert_eq!(
        semantic_scholar_target(
            "/api/semantic-scholar/graph/v1/paper/abc",
            "?fields=title",
            UPSTREAM
        ),
        Some("https://api.semanticscholar.org/graph/v1/paper/abc?fields=title".to_string())
    );
    assert_eq!(
        semantic_scholar_target(
            "/api/semantic-scholar/recommendations/v1/papers",
            "",
            UPSTREAM
        ),
        Some("https://api.semanticscholar.org/recommendations/v1/papers".to_string())
    );
    assert_eq!(
        semantic_scholar_target("/api/semantic-scholar/graph/v1/a:b", "", UPSTREAM),
        Some("https://api.semanticscholar.org/graph/v1/a:b".to_string())
    );
    assert_eq!(
        semantic_scholar_target("/api/semantic-scholar/1http://x", "", UPSTREAM),
        Some("https://api.semanticscholar.org/1http://x".to_string())
    );

    for path in [
        "/api/semantic-scholar/",
        "/api/semantic-scholar/a/../b",
        "/api/semantic-scholar//evil.com/x",
        "/api/semantic-scholar/https://evil.com/x",
        "/api/semantic-scholar/HTTP://evil.com",
        "/api/other/x",
        "/api/semantic-scholar",
    ] {
        assert_eq!(semantic_scholar_target(path, "", UPSTREAM), None, "{path}");
    }
}

#[test]
fn proxy_request_prefix() {
    let yes = Url::parse("app://weaveforge/api/semantic-scholar/graph/v1/x").unwrap();
    let no = Url::parse("app://weaveforge/api/other/x").unwrap();
    assert!(is_semantic_scholar_proxy_request(&yes));
    assert!(!is_semantic_scholar_proxy_request(&no));
}

#[test]
fn forwarded_headers_rules() {
    let mut incoming = HeaderMap::new();
    let _ = incoming.insert("x-api-key", HeaderValue::from_static("k"));
    let _ = incoming.insert("content-type", HeaderValue::from_static("application/json"));
    let _ = incoming.insert("cookie", HeaderValue::from_static("c"));
    let _ = incoming.insert("authorization", HeaderValue::from_static("a"));
    let _ = incoming.insert("accept", HeaderValue::from_static("text/html"));
    let _ = incoming.insert("referer", HeaderValue::from_static("r"));
    assert_eq!(
        forwarded_headers(&incoming),
        pairs(&[
            ("accept", "application/json"),
            ("x-api-key", "k"),
            ("content-type", "application/json"),
        ])
    );

    let mut empty_key = HeaderMap::new();
    let _ = empty_key.insert("x-api-key", HeaderValue::from_static(""));
    assert_eq!(
        forwarded_headers(&empty_key),
        pairs(&[("accept", "application/json")])
    );

    assert_eq!(
        forwarded_headers(&HeaderMap::new()),
        pairs(&[("accept", "application/json")])
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn refusals() {
    let client = relay_client().unwrap();
    let up = "http://127.0.0.1:9";
    let timeout = Duration::from_secs(5);
    let retry = Duration::from_millis(10);

    let put = request(
        "PUT",
        "/api/semantic-scholar/graph/v1/x",
        HeaderMap::new(),
        b"",
    );
    let answer = proxy_semantic_scholar(&client, &put, up, timeout, retry).await;
    assert_eq!(answer.status, 405);
    assert_eq!(answer.body, br#"{"error":"Method not allowed"}"#.to_vec());

    let bad = request("GET", "/api/semantic-scholar/", HeaderMap::new(), b"");
    let answer = proxy_semantic_scholar(&client, &bad, up, timeout, retry).await;
    assert_eq!(answer.status, 400);
    assert_eq!(
        answer.body,
        br#"{"error":"Bad Semantic Scholar path"}"#.to_vec()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn get_relays_status_and_body() {
    let up = upstream::serve(vec![(
        "/graph/v1/paper/x",
        vec![response(
            200,
            &[("Content-Type", "application/json")],
            br#"{"data":[]}"#,
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let mut headers = HeaderMap::new();
    let _ = headers.insert("x-api-key", HeaderValue::from_static("k"));
    let _ = headers.insert("cookie", HeaderValue::from_static("c"));
    let req = request(
        "GET",
        "/api/semantic-scholar/graph/v1/paper/x?fields=title",
        headers,
        b"",
    );
    let answer = proxy_semantic_scholar(
        &client,
        &req,
        &base(&up),
        Duration::from_secs(5),
        Duration::from_millis(10),
    )
    .await;

    assert_eq!(answer.status, 200);
    assert_eq!(
        answer.headers,
        pairs(&[
            ("content-type", "application/json"),
            ("x-content-type-options", "nosniff"),
        ])
    );
    assert_eq!(answer.body, br#"{"data":[]}"#.to_vec());

    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].target, "/graph/v1/paper/x?fields=title");
    assert_eq!(seen[0].header("accept"), Some("application/json"));
    assert_eq!(seen[0].header("x-api-key"), Some("k"));
    assert_eq!(seen[0].header("cookie"), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn post_sends_body() {
    let up = upstream::serve(vec![(
        "/recommendations/v1/papers",
        vec![response(
            200,
            &[("Content-Type", "application/json")],
            b"{}",
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let mut headers = HeaderMap::new();
    let _ = headers.insert("content-type", HeaderValue::from_static("application/json"));
    let req = request(
        "POST",
        "/api/semantic-scholar/recommendations/v1/papers",
        headers,
        br#"{"ids":["a"]}"#,
    );
    let answer = proxy_semantic_scholar(
        &client,
        &req,
        &base(&up),
        Duration::from_secs(5),
        Duration::from_millis(10),
    )
    .await;

    assert_eq!(answer.status, 200);
    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].body, br#"{"ids":["a"]}"#.to_vec());
    assert_eq!(seen[0].header("content-type"), Some("application/json"));
}

async fn run_get(up: &upstream::Upstream, path: &str, timeout: Duration) -> Answer {
    let client = relay_client().unwrap();
    let req = request(
        "GET",
        &format!("/api/semantic-scholar{path}"),
        HeaderMap::new(),
        b"",
    );
    proxy_semantic_scholar(&client, &req, &base(up), timeout, Duration::from_millis(10)).await
}

#[tokio::test(flavor = "multi_thread")]
async fn retries_429_then_succeeds() {
    let up = upstream::serve(vec![(
        "/graph/v1/r",
        vec![
            response(429, &[], b"slow"),
            response(429, &[], b"slow"),
            response(200, &[("Content-Type", "text/plain")], b"ok"),
        ],
    )])
    .await;
    let started = Instant::now();
    let answer = run_get(&up, "/graph/v1/r", Duration::from_secs(5)).await;
    assert!(started.elapsed() >= Duration::from_millis(30));

    assert_eq!(answer.status, 200);
    assert_eq!(answer.body, b"ok".to_vec());
    assert_eq!(up.seen().len(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn gives_up_after_three_retries() {
    let up = upstream::serve(vec![("/graph/v1/r", vec![response(429, &[], b"slow")])]).await;
    let started = Instant::now();
    let answer = run_get(&up, "/graph/v1/r", Duration::from_secs(5)).await;
    // The waits grow: 10 + 20 + 30 ms. Equal waits would total only 30 ms.
    assert!(started.elapsed() >= Duration::from_millis(60));

    assert_eq!(answer.status, 429);
    assert_eq!(answer.body, b"slow".to_vec());
    assert_eq!(up.seen().len(), 4);
}

#[tokio::test(flavor = "multi_thread")]
async fn non_429_error_is_not_retried() {
    let up = upstream::serve(vec![("/graph/v1/r", vec![response(500, &[], b"boom")])]).await;
    let answer = run_get(&up, "/graph/v1/r", Duration::from_secs(5)).await;

    assert_eq!(answer.status, 500);
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn stops_after_429_then_500() {
    let up = upstream::serve(vec![(
        "/graph/v1/r",
        vec![response(429, &[], b"slow"), response(500, &[], b"boom")],
    )])
    .await;
    let answer = run_get(&up, "/graph/v1/r", Duration::from_secs(5)).await;

    assert_eq!(answer.status, 500);
    assert_eq!(up.seen().len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_content_type_is_json() {
    let raw = b"HTTP/1.1 200 X\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".to_vec();
    let up = upstream::serve(vec![("/graph/v1/r", vec![Reply::Raw(raw)])]).await;
    let answer = run_get(&up, "/graph/v1/r", Duration::from_secs(5)).await;

    assert_eq!(answer.status, 200);
    assert_eq!(answer.header("content-type"), Some("application/json"));
    assert_eq!(answer.body, b"ok".to_vec());
}

#[tokio::test(flavor = "multi_thread")]
async fn redirect_is_502() {
    let up = upstream::serve(vec![
        ("/graph/v1/r", vec![redirect("/elsewhere")]),
        ("/elsewhere", vec![response(200, &[], b"ok")]),
    ])
    .await;
    let answer = run_get(&up, "/graph/v1/r", Duration::from_secs(5)).await;

    assert_eq!(up.seen().len(), 1);
    assert_eq!(answer.status, 502);
    assert_eq!(
        answer.body,
        br#"{"error":"Upstream fetch failed"}"#.to_vec()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn silent_upstream_times_out() {
    let up = upstream::serve(vec![("/graph/v1/r", vec![Reply::Silent])]).await;
    let started = Instant::now();
    let answer = run_get(&up, "/graph/v1/r", Duration::from_millis(300)).await;

    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(answer.status, 502);
    assert_eq!(
        answer.body,
        br#"{"error":"Upstream fetch failed"}"#.to_vec()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_is_502() {
    let client = relay_client().unwrap();
    let req = request(
        "GET",
        "/api/semantic-scholar/graph/v1/r",
        HeaderMap::new(),
        b"",
    );
    let answer = proxy_semantic_scholar(
        &client,
        &req,
        "http://127.0.0.1:9",
        Duration::from_secs(5),
        Duration::from_millis(10),
    )
    .await;

    assert_eq!(answer.status, 502);
    assert_eq!(
        answer.body,
        br#"{"error":"Upstream fetch failed"}"#.to_vec()
    );
}

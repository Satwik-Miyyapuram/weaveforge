//! Tests for the blob relay (ported from apps/desktop/src/blob-proxy.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "common/upstream.rs"]
mod upstream;

use std::time::{Duration, Instant};

use reqwest::Url;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use upstream::{Reply, Upstream, redirect, response, serve};
use weaveforge_shell::relay::blob::{is_blob_proxy_request, proxy_blob, relay_to_hosted_app};
use weaveforge_shell::relay::shared::{Answer, RelayRequest, relay_client};

const SHORT: Duration = Duration::from_secs(5);
const NO_HOST: &str = "http://127.0.0.1:9";

fn request(method: &str, url: &str, headers: &[(&str, &str)], body: Vec<u8>) -> RelayRequest {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let _ = map.insert(
            HeaderName::from_bytes(name.as_bytes()).unwrap(),
            HeaderValue::from_str(value).unwrap(),
        );
    }
    RelayRequest {
        method: method.to_string(),
        url: Url::parse(url).unwrap(),
        headers: map,
        body,
    }
}

fn base(up: &Upstream) -> String {
    up.base.as_str().trim_end_matches('/').to_string()
}

fn body_text(answer: &Answer) -> String {
    String::from_utf8(answer.body.clone()).unwrap()
}

fn assert_refusal(answer: &Answer, status: u16, error: &str) {
    assert_eq!(answer.status, status);
    assert_eq!(body_text(answer), format!(r#"{{"error":"{error}"}}"#));
}

#[test]
fn is_blob_proxy_request_matches_prefix_only() {
    let url = |s: &str| Url::parse(s).unwrap();
    assert!(is_blob_proxy_request(&url("app://localhost/api/blobs/x")));
    assert!(is_blob_proxy_request(&url("app://localhost/api/blobs/")));
    assert!(!is_blob_proxy_request(&url("app://localhost/api/blobs")));
    assert!(!is_blob_proxy_request(&url("app://localhost/api/blobsx/y")));
}

#[tokio::test(flavor = "multi_thread")]
async fn refusals_need_no_network() {
    let client = relay_client().unwrap();
    for method in ["PUT", "DELETE"] {
        let req = request(method, "app://localhost/api/blobs/x", &[], vec![]);
        let answer = proxy_blob(&client, &req, NO_HOST, SHORT).await;
        assert_refusal(&answer, 405, "Method not allowed");
    }
    // The URL parser already resolves "/../" segments, so `a/../../x` becomes `/api/x`
    // and is not a blob path at all.
    let escaped = Url::parse("app://localhost/api/blobs/a/../../x").unwrap();
    assert_eq!(escaped.path(), "/api/x");
    assert!(!is_blob_proxy_request(&escaped));
    for path in [
        "app://localhost/api/blobs/",
        "app://localhost/api/blobs/a..b",
        "app://localhost/api/blobs/a//b",
    ] {
        let req = request("GET", path, &[], vec![]);
        let answer = proxy_blob(&client, &req, NO_HOST, SHORT).await;
        assert_refusal(&answer, 400, "Bad blob path");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn get_forwards_path_and_query() {
    let up = serve(vec![(
        "/api/blobs/view/abc",
        vec![response(
            200,
            &[("Content-Type", "image/png")],
            &[0x89, b'P'],
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request(
        "GET",
        "app://localhost/api/blobs/view/abc?sig=1&exp=2",
        &[],
        vec![],
    );
    let answer = proxy_blob(&client, &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 200);
    assert_eq!(answer.header("content-type"), Some("image/png"));
    assert_eq!(answer.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(answer.body, vec![0x89, b'P']);

    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].target, "/api/blobs/view/abc?sig=1&exp=2");
    assert_eq!(seen[0].method, "GET");
    assert!(seen[0].body.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn bare_question_mark_adds_no_search() {
    let up = serve(vec![("/api/blobs/x", vec![response(200, &[], b"")])]).await;
    let client = relay_client().unwrap();
    let req = request("GET", "app://localhost/api/blobs/x?", &[], vec![]);
    let answer = proxy_blob(&client, &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 200);
    assert_eq!(up.seen()[0].target, "/api/blobs/x");
}

#[tokio::test(flavor = "multi_thread")]
async fn lowercase_post_is_accepted_and_body_is_bytes() {
    let up = serve(vec![("/api/blobs/up", vec![response(200, &[], b"")])]).await;
    let client = relay_client().unwrap();
    let mut body = vec![0x00, 0xff];
    body.extend_from_slice(b"\r\n--XyZ--\r\n");
    let req = request(
        "post",
        "app://localhost/api/blobs/up",
        &[("content-type", "multipart/form-data; boundary=XyZ")],
        body.clone(),
    );
    let answer = proxy_blob(&client, &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 200);

    let seen = up.seen();
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].body, body);
    assert_eq!(
        seen[0].header("content-type"),
        Some("multipart/form-data; boundary=XyZ")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn only_auth_and_type_travel() {
    let up = serve(vec![("/api/blobs/h", vec![response(200, &[], b"")])]).await;
    let client = relay_client().unwrap();
    let req = request(
        "GET",
        "app://localhost/api/blobs/h",
        &[
            ("authorization", "Bearer t"),
            ("cookie", "s=1"),
            ("x-api-key", "k"),
            ("referer", "r"),
        ],
        vec![],
    );
    let _ = proxy_blob(&client, &req, &base(&up), SHORT).await;
    let seen = up.seen();
    assert_eq!(seen[0].header("authorization"), Some("Bearer t"));
    assert_eq!(seen[0].header("cookie"), None);
    assert_eq!(seen[0].header("x-api-key"), None);
    assert_eq!(seen[0].header("referer"), None);

    let empty = request(
        "GET",
        "app://localhost/api/blobs/h",
        &[("authorization", "")],
        vec![],
    );
    let _ = proxy_blob(&client, &empty, &base(&up), SHORT).await;
    assert_eq!(up.seen()[1].header("authorization"), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn upstream_status_passes_through() {
    let up = serve(vec![(
        "/api/blobs/no",
        vec![response(
            403,
            &[("Content-Type", "application/json")],
            br#"{"error":"no"}"#,
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request("GET", "app://localhost/api/blobs/no", &[], vec![]);
    let answer = proxy_blob(&client, &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 403);
    assert_eq!(answer.header("content-type"), Some("application/json"));
    assert_eq!(answer.body, br#"{"error":"no"}"#.to_vec());
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_content_type_is_octet_stream() {
    let up = serve(vec![(
        "/api/blobs/raw",
        vec![Reply::Raw(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi".to_vec(),
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request("GET", "app://localhost/api/blobs/raw", &[], vec![]);
    let answer = proxy_blob(&client, &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 200);
    assert_eq!(
        answer.header("content-type"),
        Some("application/octet-stream")
    );
    assert_eq!(answer.body, b"hi".to_vec());
}

#[tokio::test(flavor = "multi_thread")]
async fn redirect_is_502() {
    let up = serve(vec![
        ("/api/blobs/r", vec![redirect("/api/blobs/target")]),
        ("/api/blobs/target", vec![response(200, &[], b"x")]),
    ])
    .await;
    let client = relay_client().unwrap();
    let req = request("GET", "app://localhost/api/blobs/r", &[], vec![]);
    let answer = proxy_blob(&client, &req, &base(&up), SHORT).await;
    assert_refusal(&answer, 502, "Upstream fetch failed");

    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].target, "/api/blobs/r");
}

#[tokio::test(flavor = "multi_thread")]
async fn silent_upstream_times_out() {
    let up = serve(vec![("/api/blobs/slow", vec![Reply::Silent])]).await;
    let client = relay_client().unwrap();
    let req = request("GET", "app://localhost/api/blobs/slow", &[], vec![]);
    let started = Instant::now();
    let answer = proxy_blob(&client, &req, &base(&up), Duration::from_millis(300)).await;
    assert_refusal(&answer, 502, "Upstream fetch failed");
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[tokio::test(flavor = "multi_thread")]
async fn body_that_stalls_times_out() {
    let up = serve(vec![(
        "/api/blobs/half",
        vec![Reply::HeadThenStall(
            "HTTP/1.1 200 OK\r\nContent-Length: 10".to_string(),
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request("GET", "app://localhost/api/blobs/half", &[], vec![]);
    let answer = proxy_blob(&client, &req, &base(&up), Duration::from_millis(300)).await;
    assert_refusal(&answer, 502, "Upstream fetch failed");
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_is_502() {
    let client = relay_client().unwrap();
    let req = request("GET", "app://localhost/api/blobs/x", &[], vec![]);
    let answer = proxy_blob(&client, &req, NO_HOST, SHORT).await;
    assert_refusal(&answer, 502, "Upstream fetch failed");
}

#[tokio::test(flavor = "multi_thread")]
async fn relay_to_hosted_app_uses_the_given_path() {
    let up = serve(vec![(
        "/api/account/delete",
        vec![response(200, &[], b"ok")],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request("POST", "app://localhost/x", &[], vec![]);
    let answer = relay_to_hosted_app(
        &client,
        &req,
        "/api/account/delete?x=1",
        &base(&up),
        SHORT,
        "account",
    )
    .await;
    assert_eq!(answer.status, 200);
    assert_eq!(up.seen()[0].target, "/api/account/delete?x=1");
}

#[tokio::test(flavor = "multi_thread")]
async fn unparseable_method_is_405() {
    let client = relay_client().unwrap();
    let req = request("BAD METHOD", "app://localhost/x", &[], vec![]);
    let answer = relay_to_hosted_app(&client, &req, "/api/x", NO_HOST, SHORT, "account").await;
    assert_refusal(&answer, 405, "Method not allowed");
}

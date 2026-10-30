//! Tests for the account relay (ported from apps/desktop/src/account-proxy.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "common/upstream.rs"]
mod upstream;

use std::time::{Duration, Instant};

use reqwest::Url;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use upstream::{Reply, Upstream, redirect, response, serve};
use weaveforge_shell::relay::account::{is_account_proxy_request, proxy_account};
use weaveforge_shell::relay::shared::{Answer, RelayRequest, relay_client};

const SHORT: Duration = Duration::from_secs(5);
const NO_HOST: &str = "http://127.0.0.1:9";
const DELETE: &str = "/api/account/delete-user";
const OTP: &str = "/api/account/delete-user/otp";

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

/// POSTs `app://localhost{path}?leak=1` with a cookie and an extra header, and checks
/// that only the query-free path, the body and the two headers reach the hosted app.
async fn relays_post(path: &'static str) {
    let up = serve(vec![(
        path,
        vec![response(
            200,
            &[("Content-Type", "application/json")],
            br#"{"ok":true}"#,
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request(
        "POST",
        &format!("app://localhost{path}?leak=1"),
        &[
            ("authorization", "Bearer t"),
            ("content-type", "application/json"),
            ("cookie", "c"),
            ("x-other", "o"),
        ],
        br#"{"confirm":true}"#.to_vec(),
    );
    let answer = proxy_account(&client, &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 200);
    assert_eq!(answer.header("content-type"), Some("application/json"));
    assert_eq!(answer.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(body_text(&answer), r#"{"ok":true}"#);

    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].method, "POST");
    assert_eq!(seen[0].target, path);
    assert_eq!(seen[0].body, br#"{"confirm":true}"#.to_vec());
    assert_eq!(seen[0].header("authorization"), Some("Bearer t"));
    assert_eq!(seen[0].header("content-type"), Some("application/json"));
    assert_eq!(seen[0].header("cookie"), None);
    assert_eq!(seen[0].header("x-other"), None);
}

#[test]
fn matches_only_the_two_paths() {
    let url = |s: &str| Url::parse(s).unwrap();
    assert!(is_account_proxy_request(&url(
        "app://localhost/api/account/delete-user"
    )));
    assert!(is_account_proxy_request(&url(
        "app://localhost/api/account/delete-user/otp"
    )));
    assert!(is_account_proxy_request(&url(
        "app://localhost/api/account/delete-user?x=1"
    )));
    assert!(is_account_proxy_request(&url(
        "app://localhost/api/account/delete-user/otp?x=1"
    )));
    assert!(!is_account_proxy_request(&url(
        "app://localhost/api/account/delete-user/"
    )));
    assert!(!is_account_proxy_request(&url(
        "app://localhost/api/account/delete-user/otp/x"
    )));
    assert!(!is_account_proxy_request(&url(
        "app://localhost/api/account"
    )));
    assert!(!is_account_proxy_request(&url(
        "app://localhost/api/account/delete-userx"
    )));
    assert!(!is_account_proxy_request(&url(
        "app://localhost/API/account/delete-user"
    )));
}

#[tokio::test(flavor = "multi_thread")]
async fn non_post_is_405() {
    let client = relay_client().unwrap();
    for method in ["GET", "PUT", "DELETE", "HEAD"] {
        let req = request(method, &format!("app://localhost{DELETE}"), &[], vec![]);
        let answer = proxy_account(&client, &req, NO_HOST, SHORT).await;
        assert_refusal(&answer, 405, "Method not allowed");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn lowercase_post_is_not_refused() {
    let up = serve(vec![(
        DELETE,
        vec![response(
            200,
            &[("Content-Type", "application/json")],
            b"{}",
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request(
        "post",
        &format!("app://localhost{DELETE}"),
        &[],
        b"{}".to_vec(),
    );
    let answer = proxy_account(&client, &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 200);
    assert_eq!(up.seen()[0].method, "POST");
}

#[tokio::test(flavor = "multi_thread")]
async fn post_relays_body_and_two_headers() {
    relays_post(DELETE).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn otp_path_is_relayed() {
    relays_post(OTP).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn upstream_status_passes_through() {
    let up = serve(vec![(
        DELETE,
        vec![response(
            401,
            &[("Content-Type", "application/json")],
            br#"{"error":"no"}"#,
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request(
        "POST",
        &format!("app://localhost{DELETE}"),
        &[],
        b"{}".to_vec(),
    );
    let answer = proxy_account(&client, &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 401);
    assert_eq!(body_text(&answer), r#"{"error":"no"}"#);
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_content_type_is_octet_stream() {
    let up = serve(vec![(
        OTP,
        vec![Reply::Raw(
            b"HTTP/1.1 200 X\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi".to_vec(),
        )],
    )])
    .await;
    let client = relay_client().unwrap();
    let req = request(
        "POST",
        &format!("app://localhost{OTP}"),
        &[],
        b"{}".to_vec(),
    );
    let answer = proxy_account(&client, &req, &base(&up), SHORT).await;
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
        (DELETE, vec![redirect("/elsewhere")]),
        ("/elsewhere", vec![response(200, &[], b"{}")]),
    ])
    .await;
    let client = relay_client().unwrap();
    let req = request(
        "POST",
        &format!("app://localhost{DELETE}"),
        &[],
        b"{}".to_vec(),
    );
    let answer = proxy_account(&client, &req, &base(&up), SHORT).await;
    assert_refusal(&answer, 502, "Upstream fetch failed");
    // The redirect was not followed.
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_is_502() {
    let client = relay_client().unwrap();
    let req = request(
        "POST",
        &format!("app://localhost{DELETE}"),
        &[],
        b"{}".to_vec(),
    );
    let answer = proxy_account(&client, &req, NO_HOST, SHORT).await;
    assert_refusal(&answer, 502, "Upstream fetch failed");
}

#[tokio::test(flavor = "multi_thread")]
async fn silent_upstream_times_out() {
    let up = serve(vec![(DELETE, vec![Reply::Silent])]).await;
    let client = relay_client().unwrap();
    let req = request(
        "POST",
        &format!("app://localhost{DELETE}"),
        &[],
        b"{}".to_vec(),
    );
    let started = Instant::now();
    let answer = proxy_account(&client, &req, &base(&up), Duration::from_millis(300)).await;
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_refusal(&answer, 502, "Upstream fetch failed");
}

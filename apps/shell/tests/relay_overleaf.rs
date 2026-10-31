//! Tests for the Overleaf Workshop relay (ported from apps/desktop/test/overleaf-proxy.test.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "common/upstream.rs"]
mod upstream;

use std::time::Duration;

use reqwest::Url;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use upstream::{Upstream, response, serve};
use weaveforge_shell::relay::overleaf::{
    OVERLEAF_PROXY_ROUTES, is_overleaf_proxy_request, proxy_overleaf,
};
use weaveforge_shell::relay::route::{RelayConfig, answer_relay};
use weaveforge_shell::relay::shared::{Answer, RelayRequest, relay_client};

const SHORT: Duration = Duration::from_secs(5);
const NO_HOST: &str = "http://127.0.0.1:9";
const APP: &str = "app://localhost";
const SESSION: &str = "/api/overleaf/workshop/session";
const PROJECTS: &str = "/api/overleaf/workshop/projects";
const COMPILE: &str = "/api/overleaf/workshop/compile";
const PDF: &str = "/api/overleaf/workshop/pdf";
const METHOD_NOT_ALLOWED: &str = r#"{"error":"Method not allowed"}"#;

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

fn ok_json() -> upstream::Reply {
    response(
        200,
        &[("Content-Type", "application/json")],
        br#"{"ok":true}"#,
    )
}

fn config(hosted_app: &str) -> RelayConfig {
    RelayConfig {
        hosted_app: hosted_app.to_string(),
        semantic_scholar: NO_HOST.to_string(),
        arxiv: NO_HOST.to_string(),
        timeout: SHORT,
        retry_unit: Duration::from_millis(1),
        semantic_scholar_timeout: SHORT,
        arxiv_timeout: SHORT,
    }
}

#[test]
fn only_the_four_workshop_routes_are_relayed() {
    let url = |s: &str| Url::parse(s).unwrap();
    assert_eq!(OVERLEAF_PROXY_ROUTES.len(), 4);
    for route in ["session", "projects", "compile", "pdf"] {
        assert!(
            is_overleaf_proxy_request(&url(&format!("{APP}/api/overleaf/workshop/{route}"))),
            "{route}"
        );
    }
    assert!(is_overleaf_proxy_request(&url(&format!(
        "{APP}/api/overleaf/workshop/session?id=abc"
    ))));
    assert!(!is_overleaf_proxy_request(&url(&format!(
        "{APP}/api/overleaf/workshop/session/x"
    ))));
    assert!(!is_overleaf_proxy_request(&url(&format!(
        "{APP}/api/overleaf/reports"
    ))));
    assert!(!is_overleaf_proxy_request(&url(&format!("{APP}/report"))));
}

#[test]
fn other_workshop_path_is_not_an_overleaf_request() {
    let url = Url::parse(&format!("{APP}/api/overleaf/workshop/other")).unwrap();
    assert!(!is_overleaf_proxy_request(&url));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dispatcher_relays_sign_in_with_token_and_body_and_no_cookie() {
    let up = serve(vec![(SESSION, vec![ok_json()])]).await;
    let body = r#"{"cookie":"overleaf_session2=s"}"#;
    let req = request(
        "POST",
        &format!("{APP}{SESSION}"),
        &[
            ("authorization", "Bearer t"),
            ("content-type", "application/json"),
            ("cookie", "no"),
        ],
        body.as_bytes().to_vec(),
    );
    let answer = answer_relay(&relay_client().unwrap(), &req, &config(&base(&up)))
        .await
        .expect("the session route must not fall through to the static bundle");
    assert_eq!(answer.status, 200);
    let seen = up.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].target, SESSION);
    assert_eq!(seen[0].header("authorization"), Some("Bearer t"));
    assert_eq!(seen[0].header("cookie"), None);
    assert_eq!(seen[0].body, body.as_bytes().to_vec());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn forgetting_a_session_keeps_its_id_in_the_query() {
    let up = serve(vec![(SESSION, vec![ok_json()])]).await;
    let req = request("DELETE", &format!("{APP}{SESSION}?id=abc"), &[], vec![]);
    let answer = proxy_overleaf(&relay_client().unwrap(), &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 200);
    let seen = up.seen();
    assert_eq!(seen[0].method, "DELETE");
    assert_eq!(seen[0].target, "/api/overleaf/workshop/session?id=abc");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_compiled_pdf_comes_back_as_bytes() {
    let up = serve(vec![(
        PDF,
        vec![response(
            200,
            &[("Content-Type", "application/pdf")],
            b"%PDF-1.7",
        )],
    )])
    .await;
    let req = request("POST", &format!("{APP}{PDF}"), &[], b"{}".to_vec());
    let answer = proxy_overleaf(&relay_client().unwrap(), &req, &base(&up), SHORT).await;
    assert_eq!(answer.header("content-type"), Some("application/pdf"));
    assert_eq!(answer.body, b"%PDF-1.7".to_vec());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn other_methods_are_refused_and_failures_pass_through() {
    let up = serve(vec![(COMPILE, vec![response(401, &[], b"")])]).await;
    let client = relay_client().unwrap();

    let get = request("GET", &format!("{APP}{COMPILE}"), &[], vec![]);
    let answer = proxy_overleaf(&client, &get, &base(&up), SHORT).await;
    assert_eq!(answer.status, 405);
    assert_eq!(body_text(&answer), METHOD_NOT_ALLOWED);

    let del = request("DELETE", &format!("{APP}{PDF}"), &[], vec![]);
    assert_eq!(
        proxy_overleaf(&client, &del, &base(&up), SHORT)
            .await
            .status,
        405
    );
    assert!(up.seen().is_empty());

    let post = request("POST", &format!("{APP}{COMPILE}"), &[], b"{}".to_vec());
    assert_eq!(
        proxy_overleaf(&client, &post, &base(&up), SHORT)
            .await
            .status,
        401
    );

    let dead = request("POST", &format!("{APP}{PROJECTS}"), &[], vec![]);
    let answer = proxy_overleaf(&client, &dead, NO_HOST, SHORT).await;
    assert_eq!(answer.status, 502);
    assert_eq!(body_text(&answer), r#"{"error":"Upstream fetch failed"}"#);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn each_route_with_an_allowed_method_reaches_the_upstream() {
    let up = serve(vec![
        (SESSION, vec![ok_json()]),
        (PROJECTS, vec![ok_json()]),
        (COMPILE, vec![ok_json()]),
        (PDF, vec![ok_json()]),
    ])
    .await;
    let client = relay_client().unwrap();
    let routes = [SESSION, PROJECTS, COMPILE, PDF];
    for route in routes {
        let req = request(
            "POST",
            &format!("{APP}{route}?x=1"),
            &[
                ("authorization", "Bearer t"),
                ("content-type", "application/json"),
                ("cookie", "c"),
            ],
            br#"{"a":1}"#.to_vec(),
        );
        let answer = proxy_overleaf(&client, &req, &base(&up), SHORT).await;
        assert_eq!(answer.status, 200, "{route}");
    }
    let seen = up.seen();
    assert_eq!(seen.len(), 4);
    for (got, route) in seen.iter().zip(routes) {
        assert_eq!(got.target, format!("{route}?x=1"));
        assert_eq!(got.method, "POST");
        assert_eq!(got.body, br#"{"a":1}"#.to_vec());
        assert_eq!(got.header("authorization"), Some("Bearer t"));
        assert_eq!(got.header("content-type"), Some("application/json"));
        assert_eq!(got.header("cookie"), None);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delete_on_projects_is_405_and_never_reaches_upstream() {
    let up = serve(vec![(PROJECTS, vec![ok_json()])]).await;
    let req = request("DELETE", &format!("{APP}{PROJECTS}"), &[], vec![]);
    let answer = proxy_overleaf(&relay_client().unwrap(), &req, &base(&up), SHORT).await;
    assert_eq!(answer.status, 405);
    assert_eq!(body_text(&answer), METHOD_NOT_ALLOWED);
    assert!(up.seen().is_empty());
}

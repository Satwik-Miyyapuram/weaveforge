#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, HeaderValue, Request, StatusCode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tower::ServiceExt;
use wf_relay::relay::route::RelayConfig;
use wf_relay_server::config::Config;
use wf_relay_server::limiter::{PAGE_FETCH_LIMIT, PASTE_FETCH_LIMIT, RateLimiter};
use wf_relay_server::routes::{AppState, app};
use wf_relay_server::url_meta::MetaUpstreams;

const ORIGIN: &str = "https://app.weaveforge.org";
const SESSION: &str = "Bearer a.b.c";

/// Answers every request with one fixed response; returns the base address.
async fn fake_upstream(
    status: &'static str,
    content_type: &'static str,
    body: &'static str,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    drop(tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            drop(tokio::spawn(async move {
                let mut seen = Vec::new();
                let mut buf = [0u8; 4096];
                while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                    match socket.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => seen.extend_from_slice(&buf[..n]),
                    }
                }
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }));
        }
    }));
    format!("http://{addr}")
}

/// A getUser stand-in that accepts every token as user `user-1`.
async fn fake_get_user() -> String {
    fake_upstream("200 OK", "application/json", r#"{"id":"user-1"}"#).await
}

fn config(supabase: &str, origins: &[&str]) -> Config {
    Config {
        supabase_url: supabase.to_string(),
        data_url: format!("{supabase}/rest/v1"),
        anon_key: "anon".to_string(),
        service_role_key: "service".to_string(),
        jwt_secret: Some("secret".to_string()),
        allowed_origins: origins.iter().map(ToString::to_string).collect(),
        bind: "127.0.0.1:0".parse().expect("addr"),
    }
}

fn state(supabase: &str, arxiv: &str) -> Arc<AppState> {
    Arc::new(AppState {
        config: config(supabase, &[ORIGIN]),
        client: reqwest::Client::new(),
        relay: RelayConfig {
            arxiv: arxiv.to_string(),
            ..RelayConfig::production()
        },
        upstreams: MetaUpstreams::production(),
        pages: RateLimiter::new(PAGE_FETCH_LIMIT),
        pastes: RateLimiter::new(PASTE_FETCH_LIMIT),
    })
}

async fn send(state: Arc<AppState>, request: Request<Body>) -> (StatusCode, HeaderMap, String) {
    let response = app(state)
        .oneshot(request)
        .await
        .expect("router is infallible");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
    (
        status,
        headers,
        String::from_utf8_lossy(&bytes).into_owned(),
    )
}

fn get(uri: &str, authorization: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method("GET").uri(uri);
    if let Some(value) = authorization {
        builder = builder.header("authorization", value);
    }
    builder.body(Body::empty()).expect("request")
}

fn preflight(uri: &str, origin: &str) -> Request<Body> {
    Request::builder()
        .method("OPTIONS")
        .uri(uri)
        .header("origin", origin)
        .header("access-control-request-method", "GET")
        .body(Body::empty())
        .expect("request")
}

#[tokio::test]
async fn healthz_answers_ok() {
    let (status, _, body) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        get("/healthz", None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "ok");
}

#[tokio::test]
async fn pdf_proxy_without_auth_is_401() {
    let (status, _, body) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        get(
            "/api/pdf-proxy?url=https%3A%2F%2Farxiv.org%2Fpdf%2F1.pdf",
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"error":"Not authenticated."}"#);
}

#[tokio::test]
async fn bad_session_shape_is_401() {
    let (status, _, body) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        get(
            "/api/url-meta?url=https://example.com",
            Some("Bearer not-a-jwt"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"error":"Invalid session."}"#);
}

#[tokio::test]
async fn pdf_proxy_rejects_hosts_off_the_allowlist() {
    let get_user = fake_get_user().await;
    let (status, _, body) = send(
        state(&get_user, "http://127.0.0.1:1/api/query"),
        get(
            "/api/pdf-proxy?url=https%3A%2F%2Fevil.example%2Fa.pdf",
            Some(SESSION),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, r#"{"error":"URL host is not allowed for PDF proxy"}"#);
}

#[tokio::test]
async fn html_proxy_refuses_plain_http() {
    let get_user = fake_get_user().await;
    let (status, _, body) = send(
        state(&get_user, "http://127.0.0.1:1/api/query"),
        get(
            "/api/html-proxy?url=http%3A%2F%2Fexample.com",
            Some(SESSION),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, r#"{"error":"Only https addresses can be fetched"}"#);
}

#[tokio::test]
async fn arxiv_needs_no_auth() {
    let arxiv = fake_upstream("200 OK", "application/atom+xml", "<feed/>").await;
    let (status, _, body) = send(
        state("http://127.0.0.1:1", &format!("{arxiv}/api/query")),
        get("/api/arxiv?id_list=2401.00001", None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "<feed/>");
}

#[tokio::test]
async fn arxiv_requires_id_list() {
    let (status, _, body) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        get("/api/arxiv", None),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, r#"{"error":"id_list is required"}"#);
}

#[tokio::test]
async fn url_meta_requires_url_after_auth() {
    let get_user = fake_get_user().await;
    let (status, _, body) = send(
        state(&get_user, "http://127.0.0.1:1/api/query"),
        get("/api/url-meta", Some(SESSION)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("url is required"), "{body}");
}

#[tokio::test]
async fn fetch_url_requires_url() {
    let (status, _, body) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        get("/api/fetch-url", None),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, r#"{"error":"url is required"}"#);
}

#[tokio::test]
async fn fetch_url_rejects_unknown_as() {
    let (status, _, body) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        get(
            "/api/fetch-url?url=https%3A%2F%2Fexample.com&as=video",
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, r#"{"error":"as must be title or image"}"#);
}

#[tokio::test]
async fn cors_preflight_allows_listed_origin() {
    let (status, headers, _) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        preflight("/api/fetch-url", ORIGIN),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get("access-control-allow-origin")
            .and_then(|v| v.to_str().ok()),
        Some(ORIGIN)
    );
}

#[tokio::test]
async fn cors_preflight_allows_the_semantic_scholar_key_header() {
    let mut request = preflight("/api/semantic-scholar/graph/v1/paper/x", ORIGIN);
    let _ = request.headers_mut().insert(
        "access-control-request-headers",
        HeaderValue::from_static("authorization,x-api-key"),
    );
    let (status, headers, _) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        request,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let allowed = headers
        .get("access-control-allow-headers")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    assert!(allowed.contains("x-api-key"), "{allowed}");
}

#[tokio::test]
async fn cors_preflight_refuses_other_origin() {
    let (_, headers, _) = send(
        state("http://127.0.0.1:1", "http://127.0.0.1:1/api/query"),
        preflight("/api/fetch-url", "https://evil.example"),
    )
    .await;
    assert!(headers.get("access-control-allow-origin").is_none());
}

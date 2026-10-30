//! Tests for the reader's PDF relay (ported from apps/desktop/src/pdf-proxy.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "common/upstream.rs"]
mod upstream;

use std::net::TcpListener;
use std::time::{Duration, Instant};

use reqwest::Url;
use upstream::{Reply, redirect, response};
use weaveforge_shell::relay::pdf::{
    PDF_PROXY_ALLOWED_HOSTS, PDF_PROXY_MAX_BYTES, has_pdf_magic, is_allowed_pdf_proxy_url,
    is_pdf_content_type, is_pdf_proxy_request, proxy_pdf, relay_pdf,
};
use weaveforge_shell::relay::shared::{Answer, refuse, relay_client};

const FIVE: Duration = Duration::from_secs(5);
const UNDER: Duration = Duration::from_secs(3);

fn client() -> reqwest::Client {
    relay_client().unwrap()
}

fn local_only(url: &Url) -> bool {
    url.host_str() == Some("127.0.0.1")
}

fn pdf_request(query: &[(&str, &str)]) -> Url {
    let mut url = Url::parse("app://localhost/api/pdf-proxy").unwrap();
    for (key, value) in query {
        let _ = url.query_pairs_mut().append_pair(key, value);
    }
    url
}

#[test]
fn allowlist_matches_the_ts_list() {
    assert_eq!(PDF_PROXY_ALLOWED_HOSTS.len(), 35);
    assert_eq!(PDF_PROXY_ALLOWED_HOSTS.first(), Some(&"arxiv.org"));
    assert_eq!(PDF_PROXY_ALLOWED_HOSTS.last(), Some(&"link.springer.com"));

    for raw in [
        "https://arxiv.org/pdf/1",
        "https://ARXIV.org/x",
        "https://link.springer.com/a.pdf",
        "https://pmc.ncbi.nlm.nih.gov/x",
    ] {
        assert!(is_allowed_pdf_proxy_url(raw), "{raw}");
    }
    for raw in [
        "http://arxiv.org/x",
        "https://evil-arxiv.org/x",
        "https://arxiv.org.evil.com/x",
        "https://u@arxiv.org/x",
        "https://u:p@arxiv.org/x",
        "https://example.com/x",
        "not a url",
        "",
    ] {
        assert!(!is_allowed_pdf_proxy_url(raw), "{raw}");
    }
}

#[test]
fn content_type_rules() {
    assert!(is_pdf_content_type(Some("application/pdf")));
    assert!(is_pdf_content_type(Some("Application/PDF; charset=binary")));
    assert!(is_pdf_content_type(Some(" application/octet-stream ")));

    assert!(!is_pdf_content_type(Some("text/html")));
    assert!(!is_pdf_content_type(Some("")));
    assert!(!is_pdf_content_type(None));
    assert!(!is_pdf_content_type(Some("application/pdfx")));
}

#[test]
fn magic_window() {
    assert!(has_pdf_magic(b"%PDF-1.7"));

    let mut inside = vec![0u8; 1020];
    inside.extend_from_slice(b"%PDF");
    assert!(has_pdf_magic(&inside));

    let mut outside = vec![0u8; 1021];
    outside.extend_from_slice(b"%PDF");
    assert!(!has_pdf_magic(&outside));

    assert!(!has_pdf_magic(b""));
    assert!(!has_pdf_magic(b"%PD"));
    assert!(has_pdf_magic(b"junk\n%PDF"));
}

#[tokio::test(flavor = "multi_thread")]
async fn proxy_pdf_refusals() {
    let client = client();

    let missing = Url::parse("app://localhost/api/pdf-proxy").unwrap();
    let answer = proxy_pdf(&client, &missing).await;
    assert_eq!(answer.status, 400);
    assert_eq!(answer.header("content-type"), Some("application/json"));
    assert_eq!(answer.body, br#"{"error":"url is required"}"#.to_vec());

    let not_allowed = "URL host is not allowed for PDF proxy";
    let cases = [
        (pdf_request(&[("url", "")]), "url is required"),
        (
            pdf_request(&[("url", "https://example.com/a.pdf")]),
            not_allowed,
        ),
        (
            pdf_request(&[("url", "http://example.com/a.pdf"), ("typed", "1")]),
            not_allowed,
        ),
        (
            pdf_request(&[("url", "https://127.0.0.1/a.pdf"), ("typed", "1")]),
            not_allowed,
        ),
        (
            pdf_request(&[("url", "https://localhost/a.pdf"), ("typed", "1")]),
            not_allowed,
        ),
        (
            pdf_request(&[("url", "https://example.com/a.pdf"), ("typed", "true")]),
            not_allowed,
        ),
    ];
    for (request, error) in cases {
        let answer = proxy_pdf(&client, &request).await;
        assert_eq!(answer, Answer::from(refuse(400, error)), "{request}");
    }
}

#[test]
fn is_pdf_proxy_request_matches_only_the_exact_path() {
    let yes = Url::parse("app://localhost/api/pdf-proxy?url=x").unwrap();
    assert!(is_pdf_proxy_request(&yes));

    for path in [
        "app://localhost/api/pdf-proxy/",
        "app://localhost/api/pdf-proxyx",
        "app://localhost/api/html-proxy",
    ] {
        let url = Url::parse(path).unwrap();
        assert!(!is_pdf_proxy_request(&url), "{path}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn serves_a_pdf() {
    let up = upstream::serve(vec![(
        "/a.pdf",
        vec![response(
            200,
            &[("Content-Type", "application/pdf")],
            b"%PDF-1.4 hello",
        )],
    )])
    .await;

    let answer = relay_pdf(
        &client(),
        &up.url("/a.pdf"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        FIVE,
    )
    .await;

    assert_eq!(answer.status, 200);
    assert_eq!(
        answer.headers,
        vec![
            ("content-type".to_string(), "application/pdf".to_string()),
            ("content-length".to_string(), "14".to_string()),
            ("x-content-type-options".to_string(), "nosniff".to_string()),
            (
                "content-security-policy".to_string(),
                "default-src 'none'; sandbox".to_string()
            ),
        ]
    );
    assert_eq!(answer.body, b"%PDF-1.4 hello".to_vec());

    let seen = up.seen();
    assert_eq!(seen[0].header("accept"), Some("application/pdf"));
    assert_eq!(seen[0].header("user-agent"), Some("WeaveForge desktop"));
}

#[tokio::test(flavor = "multi_thread")]
async fn octet_stream_with_magic_is_accepted() {
    let up = upstream::serve(vec![(
        "/a.pdf",
        vec![response(
            200,
            &[("Content-Type", "application/octet-stream")],
            b"%PDF-1.4 hi",
        )],
    )])
    .await;

    let answer = relay_pdf(
        &client(),
        &up.url("/a.pdf"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        FIVE,
    )
    .await;

    assert_eq!(answer.status, 200);
    assert_eq!(answer.header("content-type"), Some("application/pdf"));
    assert_eq!(answer.header("content-length"), Some("11"));
    assert_eq!(answer.body, b"%PDF-1.4 hi".to_vec());
}

#[tokio::test(flavor = "multi_thread")]
async fn html_labelled_is_415() {
    let up = upstream::serve(vec![(
        "/a.pdf",
        vec![response(
            200,
            &[("Content-Type", "text/html")],
            b"<html></html>",
        )],
    )])
    .await;

    let answer = relay_pdf(
        &client(),
        &up.url("/a.pdf"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        FIVE,
    )
    .await;

    assert_eq!(
        answer,
        Answer::from(refuse(415, "Upstream did not return a PDF"))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn pdf_labelled_without_magic_is_415() {
    let up = upstream::serve(vec![(
        "/a.pdf",
        vec![response(
            200,
            &[("Content-Type", "application/pdf")],
            b"<html>not a pdf</html>",
        )],
    )])
    .await;

    let answer = relay_pdf(
        &client(),
        &up.url("/a.pdf"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        FIVE,
    )
    .await;

    assert_eq!(
        answer,
        Answer::from(refuse(415, "Upstream did not return a PDF"))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn upstream_error_is_502() {
    let up = upstream::serve(vec![
        ("/missing.pdf", vec![response(404, &[], b"")]),
        ("/broken.pdf", vec![response(500, &[], b"")]),
    ])
    .await;

    let missing = relay_pdf(
        &client(),
        &up.url("/missing.pdf"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        FIVE,
    )
    .await;
    assert_eq!(missing, Answer::from(refuse(502, "Upstream returned 404")));

    let broken = relay_pdf(
        &client(),
        &up.url("/broken.pdf"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        FIVE,
    )
    .await;
    assert_eq!(broken, Answer::from(refuse(502, "Upstream returned 500")));
}

#[tokio::test(flavor = "multi_thread")]
async fn declared_too_large_is_413() {
    let up = upstream::serve(vec![(
        "/big.pdf",
        vec![Reply::HeadThenStall(
            "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 17".to_string(),
        )],
    )])
    .await;

    let started = Instant::now();
    let answer = relay_pdf(&client(), &up.url("/big.pdf"), &local_only, 16, FIVE).await;

    assert_eq!(answer, Answer::from(refuse(413, "PDF too large")));
    assert!(started.elapsed() < UNDER);
}

#[tokio::test(flavor = "multi_thread")]
async fn streamed_too_large_is_413() {
    let up = upstream::serve(vec![(
        "/big.pdf",
        vec![Reply::Raw(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nConnection: close\r\n\r\n%PDF-1.4 0123456789A"
                .to_vec(),
        )],
    )])
    .await;

    let answer = relay_pdf(&client(), &up.url("/big.pdf"), &local_only, 16, FIVE).await;

    assert_eq!(answer, Answer::from(refuse(413, "PDF too large")));
}

#[tokio::test(flavor = "multi_thread")]
async fn follows_an_allowed_redirect() {
    let up = upstream::serve(vec![
        ("/a", vec![redirect("/b")]),
        (
            "/b",
            vec![response(
                200,
                &[("Content-Type", "application/pdf")],
                b"%PDF-1.4 hi",
            )],
        ),
    ])
    .await;

    let answer = relay_pdf(
        &client(),
        &up.url("/a"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        FIVE,
    )
    .await;

    assert_eq!(answer.status, 200);
    assert_eq!(answer.body, b"%PDF-1.4 hi".to_vec());
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_redirect_to_another_host() {
    let up = upstream::serve(vec![
        ("/a", vec![redirect("http://localhost:{port}/b")]),
        (
            "/b",
            vec![response(
                200,
                &[("Content-Type", "application/pdf")],
                b"%PDF-1.4 hi",
            )],
        ),
    ])
    .await;

    let answer = relay_pdf(
        &client(),
        &up.url("/a"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        FIVE,
    )
    .await;

    assert_eq!(
        answer,
        Answer::from(refuse(400, "Redirect target not allowed"))
    );
    assert!(up.seen().iter().all(|s| s.target != "/b"));
}

#[tokio::test(flavor = "multi_thread")]
async fn stalled_body_is_504() {
    let up = upstream::serve(vec![(
        "/a.pdf",
        vec![Reply::HeadThenStall(
            "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 100".to_string(),
        )],
    )])
    .await;

    let started = Instant::now();
    let answer = relay_pdf(
        &client(),
        &up.url("/a.pdf"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        Duration::from_millis(300),
    )
    .await;

    assert_eq!(
        answer,
        Answer::from(refuse(504, "Upstream body did not arrive in time"))
    );
    assert!(started.elapsed() < UNDER);
}

#[tokio::test(flavor = "multi_thread")]
async fn silent_upstream_is_502() {
    let up = upstream::serve(vec![("/a.pdf", vec![Reply::Silent])]).await;

    let started = Instant::now();
    let answer = relay_pdf(
        &client(),
        &up.url("/a.pdf"),
        &local_only,
        PDF_PROXY_MAX_BYTES,
        Duration::from_millis(300),
    )
    .await;

    assert_eq!(answer, Answer::from(refuse(502, "Upstream fetch failed")));
    assert!(started.elapsed() < UNDER);
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_is_502() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let target = Url::parse(&format!("http://127.0.0.1:{port}/a.pdf")).unwrap();

    let answer = relay_pdf(&client(), &target, &local_only, PDF_PROXY_MAX_BYTES, FIVE).await;

    assert_eq!(answer, Answer::from(refuse(502, "Upstream fetch failed")));
}

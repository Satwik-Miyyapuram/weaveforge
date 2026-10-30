//! Tests for the reader's HTML relay (ported from html-proxy.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "common/upstream.rs"]
mod upstream;

use std::time::{Duration, Instant};

use reqwest::Url;
use weaveforge_shell::relay::html::{
    HTML_FINAL_URL_HEADER, charset_of, decode_html_bytes, is_html_content_type,
    is_html_proxy_request, proxy_html, relay_html,
};
use weaveforge_shell::relay::shared::{Answer, relay_client};

use upstream::{Reply, redirect, response, serve};

const FIVE: Duration = Duration::from_secs(5);

fn allowed(url: &Url) -> bool {
    url.host_str() == Some("127.0.0.1")
}

async fn relay(target: &Url, max: usize, timeout: Duration) -> Answer {
    let client = relay_client().unwrap();
    relay_html(&client, target, &allowed, max, timeout).await
}

fn body_text(answer: &Answer) -> String {
    String::from_utf8(answer.body.clone()).unwrap()
}

fn request_for(raw: Option<&str>) -> Url {
    let mut url = Url::parse("app://app/api/html-proxy").unwrap();
    if let Some(raw) = raw {
        let _ = url.query_pairs_mut().append_pair("url", raw);
    }
    url
}

#[test]
fn content_type_rules() {
    assert!(is_html_content_type(Some("text/html")));
    assert!(is_html_content_type(Some("TEXT/HTML; charset=utf-8")));
    assert!(is_html_content_type(Some(" application/xhtml+xml")));
    assert!(!is_html_content_type(Some("text/plain")));
    assert!(!is_html_content_type(Some("application/pdf")));
    assert!(!is_html_content_type(Some("")));
    assert!(!is_html_content_type(None));
}

#[test]
fn charset_from_header() {
    assert_eq!(
        charset_of(Some("text/html; charset=ISO-8859-2"), ""),
        "iso-8859-2"
    );
    assert_eq!(
        charset_of(Some("text/html; charset = \"Shift_JIS\""), ""),
        "shift_jis"
    );
    assert_eq!(
        charset_of(Some("text/html; charset; charset=koi8-r"), ""),
        "koi8-r"
    );
    assert_eq!(
        charset_of(
            Some("text/html; charset=utf-8"),
            r#"<meta charset="utf-16">"#
        ),
        "utf-8"
    );
}

#[test]
fn charset_from_meta() {
    assert_eq!(
        charset_of(None, r#"<meta charset="windows-1251">"#),
        "windows-1251"
    );
    assert_eq!(
        charset_of(
            None,
            r#"<META http-equiv="Content-Type" content="text/html; charset=EUC-JP">"#
        ),
        "euc-jp"
    );
    assert_eq!(charset_of(None, "<meta name=x><meta charset='gbk'>"), "gbk");
    assert_eq!(charset_of(None, "<metacharset=x>"), "utf-8");
    assert_eq!(charset_of(None, "<p>no meta</p>"), "utf-8");
}

#[test]
fn meta_beyond_4096_bytes_is_not_seen() {
    let mut bytes = vec![b'a'; 4100];
    bytes.extend_from_slice(br#"<meta charset="windows-1251">"#);
    bytes.push(0xC0);
    let decoded = decode_html_bytes(&bytes, Some("text/html"));
    assert!(decoded.ends_with('\u{FFFD}'));
}

#[test]
fn decodes_by_charset() {
    assert_eq!(
        decode_html_bytes(&[0x93], Some("text/html; charset=windows-1252")),
        "\u{201C}"
    );
    assert_eq!(
        decode_html_bytes(&[0x80], Some("text/html; charset=iso-8859-1")),
        "\u{20AC}"
    );
    assert_eq!(
        decode_html_bytes(&[0x82, 0xA0], Some("text/html; charset=shift_jis")),
        "\u{3042}"
    );
    assert_eq!(
        decode_html_bytes("é".as_bytes(), Some("text/html; charset=x-bogus")),
        "é"
    );
    assert_eq!(
        decode_html_bytes(&[0xEF, 0xBB, 0xBF, b'h', b'i'], None),
        "hi"
    );
    assert_eq!(
        decode_html_bytes(&[0xff], Some("text/html; charset=utf-8")),
        "\u{FFFD}"
    );
    // TextDecoder throws for the replacement-family labels, so the TS reads UTF-8.
    for label in ["iso-2022-kr", "csiso2022kr", "iso-2022-cn", "hz-gb-2312"] {
        assert_eq!(
            decode_html_bytes(
                "\u{e9}".as_bytes(),
                Some(&format!("text/html; charset={label}"))
            ),
            "\u{e9}",
            "{label}"
        );
    }
    // "utf-16" is UTF-16LE in both TextDecoder and encoding_rs: ASCII "ab" is U+6261.
    assert_eq!(
        decode_html_bytes(b"ab", Some("text/html; charset=utf-16")),
        "\u{6261}"
    );
}

#[tokio::test]
async fn proxy_html_refusals() {
    let client = relay_client().unwrap();
    assert!(is_html_proxy_request(&request_for(None)));

    let cases: [(Option<&str>, &str); 7] = [
        (None, "url is required"),
        (Some(""), "url is required"),
        (
            Some("http://example.com"),
            "Only https addresses can be fetched",
        ),
        (
            Some("https://localhost/x"),
            "Only https addresses can be fetched",
        ),
        (
            Some("https://10.0.0.1/x"),
            "Only https addresses can be fetched",
        ),
        (
            Some("https://u@example.com/x"),
            "Only https addresses can be fetched",
        ),
        (
            Some("https://user:pw@example.com/x"),
            "Only https addresses can be fetched",
        ),
    ];
    for (raw, error) in cases {
        let answer = proxy_html(&client, &request_for(raw)).await;
        assert_eq!(answer.status, 400, "{raw:?}");
        assert_eq!(answer.header("content-type"), Some("application/json"));
        assert_eq!(body_text(&answer), format!(r#"{{"error":"{error}"}}"#));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn serves_page_as_text() {
    let up = serve(vec![(
        "/page",
        vec![response(
            200,
            &[("Content-Type", "text/html; charset=utf-8")],
            "<p>héllo</p>".as_bytes(),
        )],
    )])
    .await;
    let page = up.url("/page");
    let answer = relay(&page, 1024, FIVE).await;

    assert_eq!(answer.status, 200);
    let final_url = page.as_str().to_string();
    let expected = vec![
        (
            "content-type".to_string(),
            "text/plain; charset=utf-8".to_string(),
        ),
        ("x-content-type-options".to_string(), "nosniff".to_string()),
        (
            "content-security-policy".to_string(),
            "default-src 'none'; sandbox".to_string(),
        ),
        ("cache-control".to_string(), "private, no-store".to_string()),
        (HTML_FINAL_URL_HEADER.to_string(), final_url),
    ];
    assert_eq!(answer.headers, expected);
    assert_eq!(answer.body, "<p>héllo</p>".as_bytes());

    let seen = up.seen();
    let first = seen.first().unwrap();
    assert_eq!(
        first.header("accept"),
        Some("text/html,application/xhtml+xml")
    );
    assert_eq!(first.header("user-agent"), Some("WeaveForge desktop"));
}

#[tokio::test(flavor = "multi_thread")]
async fn final_url_follows_redirects() {
    let up = serve(vec![
        ("/a", vec![redirect("/b")]),
        (
            "/b",
            vec![response(200, &[("Content-Type", "text/html")], b"<p>b</p>")],
        ),
    ])
    .await;
    let answer = relay(&up.url("/a"), 1024, FIVE).await;
    assert_eq!(answer.status, 200);
    assert!(
        answer
            .header(HTML_FINAL_URL_HEADER)
            .unwrap()
            .ends_with("/b")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn decodes_latin1_page() {
    let up = serve(vec![(
        "/latin",
        vec![response(
            200,
            &[("Content-Type", "text/html; charset=windows-1252")],
            &[0x93, b'x', 0x94],
        )],
    )])
    .await;
    let answer = relay(&up.url("/latin"), 1024, FIVE).await;
    assert_eq!(answer.status, 200);
    assert_eq!(answer.body, "\u{201C}x\u{201D}".as_bytes());
}

#[tokio::test(flavor = "multi_thread")]
async fn pdf_is_415() {
    let up = serve(vec![(
        "/doc.pdf",
        vec![response(
            200,
            &[("Content-Type", "application/pdf")],
            b"%PDF-1.4",
        )],
    )])
    .await;
    let answer = relay(&up.url("/doc.pdf"), 1024, FIVE).await;
    assert_eq!(answer.status, 415);
    assert_eq!(
        body_text(&answer),
        r#"{"error":"Upstream did not return a web page"}"#
    );
}

/// fetch gives a 204/205 a null body; the TS answers "Upstream sent no body".
#[tokio::test(flavor = "multi_thread")]
async fn no_content_is_502() {
    for status in [204, 205] {
        let up = serve(vec![(
            "/empty",
            vec![response(status, &[("Content-Type", "text/html")], b"")],
        )])
        .await;
        let answer = relay(&up.url("/empty"), 1024, FIVE).await;
        assert_eq!(answer.status, 502, "{status}");
        assert_eq!(body_text(&answer), r#"{"error":"Upstream sent no body"}"#);
    }
    // The TS checks the type before the body, so a 204 that is not a page is 415.
    let up = serve(vec![(
        "/empty",
        vec![response(204, &[("Content-Type", "text/plain")], b"")],
    )])
    .await;
    let answer = relay(&up.url("/empty"), 1024, FIVE).await;
    assert_eq!(answer.status, 415);
    assert_eq!(
        body_text(&answer),
        r#"{"error":"Upstream did not return a web page"}"#
    );
}

/// fetch reads header bytes as latin1, so a non-ASCII parameter does not hide the type.
#[tokio::test(flavor = "multi_thread")]
async fn non_ascii_content_type_parameter_is_accepted() {
    let up = serve(vec![(
        "/page",
        vec![response(
            200,
            &[("Content-Type", "text/html; x=\u{e9}")],
            b"<p>hi</p>",
        )],
    )])
    .await;
    let answer = relay(&up.url("/page"), 1024, FIVE).await;
    assert_eq!(answer.status, 200);
    assert_eq!(body_text(&answer), "<p>hi</p>");
}

#[tokio::test(flavor = "multi_thread")]
async fn upstream_500_is_502() {
    let up = serve(vec![(
        "/err",
        vec![response(500, &[("Content-Type", "text/html")], b"boom")],
    )])
    .await;
    let answer = relay(&up.url("/err"), 1024, FIVE).await;
    assert_eq!(answer.status, 502);
    assert_eq!(body_text(&answer), r#"{"error":"Upstream returned 500"}"#);
}

#[tokio::test(flavor = "multi_thread")]
async fn declared_too_large_is_413() {
    let up = serve(vec![(
        "/big",
        vec![Reply::HeadThenStall(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 17".to_string(),
        )],
    )])
    .await;
    let started = Instant::now();
    let answer = relay(&up.url("/big"), 16, FIVE).await;
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(answer.status, 413);
    assert_eq!(body_text(&answer), r#"{"error":"Page too large"}"#);
}

#[tokio::test(flavor = "multi_thread")]
async fn streamed_too_large_is_413() {
    let up = serve(vec![(
        "/stream",
        vec![Reply::Raw(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n01234567890123456789"
                .to_vec(),
        )],
    )])
    .await;
    let answer = relay(&up.url("/stream"), 16, FIVE).await;
    assert_eq!(answer.status, 413);
    assert_eq!(body_text(&answer), r#"{"error":"Page too large"}"#);
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_redirect_to_another_host() {
    let up = serve(vec![
        ("/a", vec![redirect("http://localhost:{port}/b")]),
        (
            "/b",
            vec![response(200, &[("Content-Type", "text/html")], b"<p>b</p>")],
        ),
    ])
    .await;
    let answer = relay(&up.url("/a"), 1024, FIVE).await;
    assert_eq!(answer.status, 400);
    assert_eq!(
        body_text(&answer),
        r#"{"error":"Redirect target not allowed"}"#
    );
    let targets: Vec<String> = up.seen().into_iter().map(|s| s.target).collect();
    assert_eq!(targets, vec!["/a".to_string()]);
}

#[tokio::test(flavor = "multi_thread")]
async fn stalled_body_is_504() {
    let up = serve(vec![(
        "/slow",
        vec![Reply::HeadThenStall(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html".to_string(),
        )],
    )])
    .await;
    let started = Instant::now();
    let answer = relay(&up.url("/slow"), 1024, Duration::from_millis(1000)).await;
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(answer.status, 504);
    assert_eq!(
        body_text(&answer),
        r#"{"error":"Upstream body did not arrive in time"}"#
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn silent_upstream_is_502() {
    let up = serve(vec![("/quiet", vec![Reply::Silent])]).await;
    let started = Instant::now();
    let answer = relay(&up.url("/quiet"), 1024, Duration::from_millis(300)).await;
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(answer.status, 502);
    assert_eq!(body_text(&answer), r#"{"error":"Upstream fetch failed"}"#);
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_is_502() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let target = Url::parse(&format!("http://127.0.0.1:{port}/x")).unwrap();
    let answer = relay(&target, 1024, FIVE).await;
    assert_eq!(answer.status, 502);
    assert_eq!(body_text(&answer), r#"{"error":"Upstream fetch failed"}"#);
}

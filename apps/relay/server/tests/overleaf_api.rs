//! The Overleaf HTTP client against a stand-in for Overleaf and its CDN.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use common::{Reply, Upstream, response, serve};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wf_relay_server::overleaf_api::{Identity, Limits, OverleafApi};

const META: &[u8] = br#"<meta name="ol-user_id" content="u1"><meta name="ol-usersEmail" content="a@b.c"><meta name="ol-csrfToken" content="tok">"#;

fn json_reply(status: u16, body: &str) -> Reply {
    response(
        status,
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
}

fn api(up: &Upstream) -> OverleafApi {
    OverleafApi::new(up.base.as_str(), 0).expect("client")
}

fn identity(cookies: &str) -> Identity {
    Identity {
        csrf_token: "tok".to_string(),
        cookies: cookies.to_string(),
    }
}

#[tokio::test]
async fn login_joins_first_set_cookie_and_sends_cookie_on_both_calls() {
    let up = serve(vec![
        ("/project", vec![response(200, &[], META)]),
        (
            "/socket.io/socket.io.js",
            vec![response(
                200,
                &[("Set-Cookie", "b=2; Path=/"), ("Set-Cookie", "c=3")],
                b"",
            )],
        ),
    ])
    .await;
    let found = api(&up)
        .cookies_login("a=1")
        .await
        .expect("login")
        .expect("identity");
    assert_eq!(
        found,
        Identity {
            csrf_token: "tok".to_string(),
            cookies: "a=1; b=2".to_string(),
        }
    );
    let sent = up.seen();
    assert_eq!(sent.len(), 2);
    assert!(sent.iter().all(|seen| seen.header("cookie") == Some("a=1")));
}

#[tokio::test]
async fn login_without_meta_is_none() {
    let up = serve(vec![(
        "/project",
        vec![response(200, &[], b"<html></html>")],
    )])
    .await;
    let found = api(&up).cookies_login("a=1").await.expect("login");
    assert_eq!(found, None);
}

#[tokio::test]
async fn login_without_set_cookie_keeps_cookies() {
    let up = serve(vec![
        ("/project", vec![response(200, &[], META)]),
        ("/socket.io/socket.io.js", vec![response(200, &[], b"")]),
    ])
    .await;
    let found = api(&up)
        .cookies_login("a=1")
        .await
        .expect("login")
        .expect("identity");
    assert_eq!(found.cookies, "a=1");
}

#[tokio::test]
async fn projects_move_underscore_id_to_id() {
    let up = serve(vec![(
        "/user/projects",
        vec![json_reply(
            200,
            r#"{"projects":[{"_id":"p1","name":"Thesis"}]}"#,
        )],
    )])
    .await;
    let projects = api(&up)
        .user_projects(&identity("a=1"))
        .await
        .expect("projects");
    assert_eq!(projects, vec![json!({"id": "p1", "name": "Thesis"})]);
    assert_eq!(up.seen()[0].header("cookie"), Some("a=1"));
}

#[tokio::test]
async fn compile_posts_csrf_body_and_header() {
    let up = serve(vec![(
        "/project/p1/compile",
        vec![json_reply(200, r#"{"status":"success"}"#)],
    )])
    .await;
    let result = api(&up)
        .compile(&identity("a=1"), "p1", Some("main.tex"))
        .await
        .expect("compile");
    assert_eq!(result, json!({"status": "success"}));
    let sent = up.seen();
    assert_eq!(sent[0].method, "POST");
    assert_eq!(sent[0].target, "/project/p1/compile?auto_compile=true");
    assert_eq!(sent[0].header("x-csrf-token"), Some("tok"));
    assert_eq!(sent[0].header("content-type"), Some("application/json"));
    assert_eq!(sent[0].header("cookie"), Some("a=1"));
    let body: Value = serde_json::from_slice(&sent[0].body).expect("json body");
    assert_eq!(
        body,
        json!({
            "_csrf": "tok",
            "check": "silent",
            "draft": false,
            "incrementalCompilesEnabled": true,
            "rootResourcePath": "main.tex",
            "stopOnFirstError": false
        })
    );
}

#[tokio::test]
async fn compile_without_root_leaves_main_document_to_overleaf() {
    let up = serve(vec![(
        "/project/p1/compile",
        vec![json_reply(200, r#"{"status":"success"}"#)],
    )])
    .await;
    let reply = api(&up)
        .compile(&identity("a=1"), "p1", None)
        .await
        .expect("compile");
    assert_eq!(reply["status"], "success");
    let body: Value = serde_json::from_slice(&up.seen()[0].body).expect("json body");
    assert!(body.get("rootResourcePath").is_none(), "{body}");
}

#[tokio::test]
async fn service_unavailable_then_ok_retries() {
    let up = serve(vec![(
        "/user/projects",
        vec![
            response(503, &[], b"busy"),
            json_reply(200, r#"{"projects":[]}"#),
        ],
    )])
    .await;
    let projects = api(&up)
        .user_projects(&identity("a=1"))
        .await
        .expect("projects");
    assert!(projects.is_empty());
    assert_eq!(up.seen().len(), 2);
}

#[tokio::test]
async fn server_error_three_times_is_err() {
    let up = serve(vec![(
        "/user/projects",
        vec![response(500, &[], b"boom secret-token")],
    )])
    .await;
    let err = api(&up)
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert_eq!(err, "Overleaf refused the request (HTTP 500).");
    assert_eq!(up.seen().len(), 3);
}

#[tokio::test]
async fn forbidden_is_not_retried() {
    let up = serve(vec![(
        "/user/projects",
        vec![response(403, &[], b"denied secret-token")],
    )])
    .await;
    let err = api(&up)
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert_eq!(err, "Overleaf refused the request (HTTP 403).");
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test]
async fn bad_json_three_times_is_err() {
    let up = serve(vec![(
        "/user/projects",
        vec![response(200, &[], b"not json secret-token")],
    )])
    .await;
    let err = api(&up)
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert_eq!(err, "Overleaf sent a reply that is not JSON.");
    assert_eq!(up.seen().len(), 3);
}

/// A client whose base has a secret in its path and nothing listening.
fn unreachable() -> OverleafApi {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("bind")
        .local_addr()
        .expect("addr")
        .port();
    OverleafApi::new(&format!("http://127.0.0.1:{port}/secret-token/"), 0).expect("client")
}

#[tokio::test]
async fn unreachable_projects_error_names_no_url() {
    let err = unreachable()
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert_eq!(err, "Could not reach Overleaf.");
}

#[tokio::test]
async fn unreachable_login_error_names_no_url() {
    let err = unreachable()
        .cookies_login("sid=secret-cookie")
        .await
        .expect_err("error");
    assert_eq!(err, "Could not reach Overleaf.");
}

#[tokio::test]
async fn unreachable_download_error_names_no_url() {
    let err = unreachable()
        .get_file_from_clsi(&identity("a=1"), "/build/output.pdf", "g", None, None)
        .await
        .expect_err("error");
    assert_eq!(err, "Could not reach Overleaf.");
}

#[tokio::test]
async fn clsi_without_cdn_uses_base_with_cookies() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![response(200, &[], b"PDF")],
    )])
    .await;
    let bytes = api(&up)
        .get_file_from_clsi(&identity("a=1"), "/build/output.pdf", "g", None, None)
        .await
        .expect("file");
    assert_eq!(bytes, b"PDF".to_vec());
    assert_eq!(up.seen()[0].header("cookie"), Some("a=1"));
}

#[tokio::test]
async fn clsi_with_cdn_sends_no_cookie() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![response(200, &[], b"PDF")],
    )])
    .await;
    let domain = up.base.as_str().trim_end_matches('/');
    let bytes = api(&up)
        .get_file_from_clsi(
            &identity("a=1"),
            "/build/output.pdf",
            "g",
            Some("s1"),
            Some(domain),
        )
        .await
        .expect("file");
    assert_eq!(bytes, b"PDF".to_vec());
    let sent = up.seen();
    assert_eq!(
        sent[0].target,
        "/build/output.pdf?compileGroup=g&clsiserverid=s1&enable_pdf_caching=true"
    );
    assert_eq!(sent[0].header("cookie"), None);
}

#[tokio::test]
async fn partial_then_whole_reply_is_err_not_spliced() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![
            response(206, &[("Content-Range", "bytes 0-1/4")], b"ab"),
            response(200, &[], b"cd"),
        ],
    )])
    .await;
    let err = api(&up)
        .get_file_from_clsi(&identity("a=1"), "/build/output.pdf", "g", None, None)
        .await
        .expect_err("error");
    assert_eq!(err, "Overleaf sent an incomplete PDF.");
    assert_eq!(up.seen().len(), 2);
}

#[tokio::test]
async fn other_download_status_is_empty() {
    let up = serve(vec![]).await;
    let bytes = api(&up)
        .get_file_from_clsi(&identity("a=1"), "/build/output.pdf", "g", None, None)
        .await
        .expect("file");
    assert!(bytes.is_empty());
}

const INCOMPLETE: &str = "Overleaf sent an incomplete PDF.";

async fn download(replies: Vec<Reply>) -> (Result<Vec<u8>, String>, usize) {
    let up = serve(vec![("/build/output.pdf", replies)]).await;
    let got = api(&up)
        .get_file_from_clsi(&identity("a=1"), "/build/output.pdf", "g", None, None)
        .await;
    (got, up.seen().len())
}

#[tokio::test]
async fn partial_then_error_status_is_err() {
    let (got, _) = download(vec![
        response(206, &[("Content-Range", "bytes 0-1/4")], b"ab"),
        response(500, &[], b"oops"),
    ])
    .await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
}

#[tokio::test]
async fn partial_without_end_hits_round_cap_and_is_err() {
    let ranges: Vec<String> = (0..100)
        .map(|i| format!("bytes {}-{}/*", 2 * i, 2 * i + 1))
        .collect();
    let replies = ranges
        .iter()
        .map(|range| response(206, &[("Content-Range", range.as_str())], b"ab"))
        .collect();
    let (got, sent) = download(replies).await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
    assert_eq!(sent, 100);
}

/// A 206 must say which bytes it holds; without that the parts cannot be put in order.
#[tokio::test]
async fn partial_without_content_range_is_err() {
    let (got, sent) = download(vec![response(206, &[], b"ab")]).await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
    assert_eq!(sent, 1);
}

/// All rounds together share one time budget: a later round past it is not sent.
#[tokio::test]
async fn download_past_its_whole_time_budget_is_incomplete() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![response(206, &[("Content-Range", "bytes 0-1/4")], b"ab")],
    )])
    .await;
    let api = OverleafApi::with_limits(
        up.base.as_str(),
        0,
        Limits {
            download_total: Duration::ZERO,
            ..Limits::default()
        },
    )
    .expect("client");
    let err = api
        .get_file_from_clsi(&identity("a=1"), "/build/output.pdf", "g", None, None)
        .await
        .expect_err("error");
    assert_eq!(err, INCOMPLETE);
    assert_eq!(up.seen().len(), 1);
}

const TOO_LARGE: &str = "Overleaf sent a reply that is too large.";

#[tokio::test]
async fn json_reply_past_the_reply_cap_is_err() {
    let body = format!(r#"{{"projects":[],"pad":"{}"}}"#, "x".repeat(2048));
    let up = serve(vec![("/user/projects", vec![json_reply(200, &body)])]).await;
    let err = limited(&up, 5000, 1024)
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert_eq!(err, TOO_LARGE);
}

#[tokio::test]
async fn login_page_past_the_reply_cap_is_err() {
    let page = "x".repeat(2048);
    let up = serve(vec![(
        "/project",
        vec![response(200, &[], page.as_bytes())],
    )])
    .await;
    let err = limited(&up, 5000, 1024)
        .cookies_login("a=1")
        .await
        .expect_err("error");
    assert_eq!(err, TOO_LARGE);
}

#[tokio::test]
async fn short_200_after_a_partial_is_err() {
    let (got, _) = download(vec![
        response(206, &[("Content-Range", "bytes 0-1/4")], b"ab"),
        response(200, &[], b"c"),
    ])
    .await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
}

#[tokio::test]
async fn partial_past_content_range_total_is_err() {
    let (got, _) = download(vec![
        response(206, &[("Content-Range", "bytes 0-1/3")], b"ab"),
        response(206, &[("Content-Range", "bytes 2-3/3")], b"cd"),
    ])
    .await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
}

#[tokio::test]
async fn partials_reaching_content_range_total_are_ok() {
    let (got, sent) = download(vec![
        response(206, &[("Content-Range", "bytes 0-1/4")], b"ab"),
        response(206, &[("Content-Range", "bytes 2-3/4")], b"cd"),
    ])
    .await;
    assert_eq!(got.expect("file"), b"abcd".to_vec());
    assert_eq!(sent, 2);
}

#[tokio::test]
async fn partial_with_unknown_total_then_200_is_err() {
    let (got, sent) = download(vec![
        response(206, &[("Content-Range", "bytes 0-1/*")], b"ab"),
        response(200, &[], b"cd"),
    ])
    .await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
    assert_eq!(sent, 2);
}

#[tokio::test]
async fn first_200_is_the_whole_pdf() {
    let (got, sent) = download(vec![response(200, &[], b"abcd")]).await;
    assert_eq!(got.expect("file"), b"abcd".to_vec());
    assert_eq!(sent, 1);
}

#[tokio::test]
async fn repeated_partial_range_with_unknown_total_is_err() {
    let (got, _) = download(vec![response(
        206,
        &[("Content-Range", "bytes 0-1/*")],
        b"ab",
    )])
    .await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
}

/// A client with a short total timeout and a small byte cap.
fn limited(up: &Upstream, total_ms: u64, max_bytes: u64) -> OverleafApi {
    OverleafApi::with_limits(
        up.base.as_str(),
        0,
        Limits {
            connect: Duration::from_secs(5),
            total: Duration::from_millis(total_ms),
            download_total: Duration::from_secs(30),
            max_download_bytes: max_bytes,
            max_reply_bytes: max_bytes,
        },
    )
    .expect("client")
}

async fn limited_download(up: &Upstream, total_ms: u64, max_bytes: u64) -> Result<Vec<u8>, String> {
    limited(up, total_ms, max_bytes)
        .get_file_from_clsi(&identity("a=1"), "/build/output.pdf", "g", None, None)
        .await
}

#[test]
fn default_limits_are_ten_seconds_to_connect_and_two_minutes_in_all() {
    let limits = Limits::default();
    assert_eq!(limits.connect, Duration::from_secs(10));
    assert_eq!(limits.total, Duration::from_secs(120));
    assert_eq!(limits.max_download_bytes, 256 * 1024 * 1024);
    assert_eq!(limits.download_total, Duration::from_secs(300));
    assert_eq!(limits.max_reply_bytes, 16 * 1024 * 1024);
}

#[tokio::test]
async fn silent_overleaf_times_out_as_unreachable() {
    let up = serve(vec![("/build/output.pdf", vec![Reply::Silent])]).await;
    let started = Instant::now();
    let err = limited_download(&up, 500, 1024).await.expect_err("error");
    assert_eq!(err, "Could not reach Overleaf.");
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[tokio::test]
async fn silent_json_call_times_out_as_unreachable() {
    let up = serve(vec![("/user/projects", vec![Reply::Silent])]).await;
    let started = Instant::now();
    let err = limited(&up, 500, 1024)
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert_eq!(err, "Could not reach Overleaf.");
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[tokio::test]
async fn stalled_body_after_a_partial_is_incomplete() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![
            response(206, &[("Content-Range", "bytes 0-1/4")], b"ab"),
            Reply::HeadThenStall(
                "HTTP/1.1 206 X\r\nContent-Range: bytes 2-3/4\r\nContent-Length: 2".to_string(),
            ),
        ],
    )])
    .await;
    let started = Instant::now();
    let err = limited_download(&up, 500, 1024).await.expect_err("error");
    assert_eq!(err, INCOMPLETE);
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[tokio::test]
async fn no_reply_after_a_partial_is_incomplete() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![
            response(206, &[("Content-Range", "bytes 0-1/4")], b"ab"),
            Reply::Silent,
        ],
    )])
    .await;
    let err = limited_download(&up, 500, 1024).await.expect_err("error");
    assert_eq!(err, INCOMPLETE);
}

#[tokio::test]
async fn body_cut_short_after_a_partial_is_incomplete() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![
            response(206, &[("Content-Range", "bytes 0-1/4")], b"ab"),
            Reply::Raw(
                b"HTTP/1.1 206 X\r\nContent-Range: bytes 2-3/4\r\nContent-Length: 2\r\nConnection: close\r\n\r\nc"
                    .to_vec(),
            ),
        ],
    )])
    .await;
    let err = limited_download(&up, 5000, 1024).await.expect_err("error");
    assert_eq!(err, INCOMPLETE);
}

#[tokio::test]
async fn body_cut_short_on_the_first_reply_is_unreachable() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![Reply::Raw(
            b"HTTP/1.1 200 X\r\nContent-Length: 4\r\nConnection: close\r\n\r\n".to_vec(),
        )],
    )])
    .await;
    let err = limited_download(&up, 5000, 1024).await.expect_err("error");
    assert_eq!(err, "Could not reach Overleaf.");
}

#[tokio::test]
async fn pdf_past_the_byte_cap_is_err() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![response(200, &[], b"abcde")],
    )])
    .await;
    let err = limited_download(&up, 5000, 4).await.expect_err("error");
    assert_eq!(err, INCOMPLETE);
}

#[tokio::test]
async fn pdf_at_the_byte_cap_is_ok() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![response(200, &[], b"abcd")],
    )])
    .await;
    let got = limited_download(&up, 5000, 4).await.expect("file");
    assert_eq!(got, b"abcd".to_vec());
}

#[tokio::test]
async fn partials_past_the_byte_cap_together_are_err() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![
            response(206, &[("Content-Range", "bytes 0-2/6")], b"abc"),
            response(206, &[("Content-Range", "bytes 3-5/6")], b"def"),
        ],
    )])
    .await;
    let err = limited_download(&up, 5000, 5).await.expect_err("error");
    assert_eq!(err, INCOMPLETE);
    assert_eq!(up.seen().len(), 2);
}

#[test]
fn identity_debug_shows_no_secret() {
    let printed = format!(
        "{:?}",
        Identity {
            csrf_token: "csrf-secret".to_string(),
            cookies: "sid=cookie-secret".to_string(),
        }
    );
    assert!(!printed.contains("csrf-secret"), "{printed}");
    assert!(!printed.contains("cookie-secret"), "{printed}");
    assert!(printed.contains("Identity"), "{printed}");
}

#[tokio::test]
async fn repeated_chunk_is_err_not_a_doubled_pdf() {
    let (got, _) = download(vec![response(
        206,
        &[("Content-Range", "bytes 0-1/4")],
        b"ab",
    )])
    .await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
}

#[tokio::test]
async fn chunk_starting_past_the_received_bytes_is_err() {
    let (got, sent) = download(vec![
        response(206, &[("Content-Range", "bytes 0-0/4")], b"a"),
        response(206, &[("Content-Range", "bytes 2-3/4")], b"cd"),
    ])
    .await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
    assert_eq!(sent, 2);
}
#[tokio::test]
async fn changed_content_range_total_is_err() {
    let (got, _) = download(vec![
        response(206, &[("Content-Range", "bytes 0-1/6")], b"ab"),
        response(206, &[("Content-Range", "bytes 2-3/4")], b"cd"),
    ])
    .await;
    assert_eq!(got.expect_err("error"), INCOMPLETE);
}

#[tokio::test]
async fn malformed_content_range_is_err() {
    for header in [
        "bytes 0-1/x",
        "bytes 0-1/18446744073709551616",
        "bytes 1-0/4",
        "bytes 0-4/4",
        "bytes a-b/4",
        "items 0-1/4",
        "bytes */4",
    ] {
        let (got, _) = download(vec![
            response(206, &[("Content-Range", header)], b"ab"),
            response(200, &[], b"cd"),
        ])
        .await;
        assert_eq!(got.expect_err("error"), INCOMPLETE, "{header}");
    }
}

const HOST_REFUSED: &str = "Overleaf named a PDF host that is not allowed.";

async fn pdf_stand_in() -> Upstream {
    serve(vec![(
        "/build/output.pdf",
        vec![response(200, &[], b"PDF")],
    )])
    .await
}

/// Downloads `/build/output.pdf` through the CDN branch with `domain`, base = `up`.
async fn cdn_download(up: &Upstream, domain: &str) -> Result<Vec<u8>, String> {
    api(up)
        .get_file_from_clsi(
            &identity("a=1"),
            "/build/output.pdf",
            "g",
            Some("s1"),
            Some(domain),
        )
        .await
}

#[tokio::test]
async fn cdn_on_another_host_is_refused_without_a_request() {
    let up = pdf_stand_in().await;
    for domain in [
        "https://evil.example",
        "http://169.254.169.254",
        "https://compiles.overleafusercontent.com.evil.example",
        "not a url",
    ] {
        let got = cdn_download(&up, domain).await;
        assert_eq!(got.expect_err("error"), HOST_REFUSED, "{domain}");
    }
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn cdn_on_a_live_host_outside_the_allowlist_gets_no_request() {
    // `localhost` is a different host from the 127.0.0.1 base, and its stand-in would answer.
    let up = pdf_stand_in().await;
    let other = pdf_stand_in().await;
    let domain = format!("http://localhost:{}", other.port);
    let got = cdn_download(&up, &domain).await;
    assert_eq!(got.expect_err("error"), HOST_REFUSED);
    assert!(other.seen().is_empty());
    assert!(up.seen().is_empty());
}

#[tokio::test]
async fn cdn_on_the_base_host_with_another_port_is_refused() {
    // Another live stand-in on the same IP but its own port.
    let up = pdf_stand_in().await;
    let other = pdf_stand_in().await;
    let domain = format!("http://127.0.0.1:{}", other.port);
    let got = cdn_download(&up, &domain).await;
    assert_eq!(got.expect_err("error"), HOST_REFUSED);
    assert!(other.seen().is_empty());
}

#[tokio::test]
async fn cdn_on_the_base_origin_is_fetched_without_cookies() {
    let up = pdf_stand_in().await;
    let domain = format!("http://127.0.0.1:{}", up.port);
    let got = cdn_download(&up, &domain).await;
    assert_eq!(got.expect("pdf"), b"PDF".to_vec());
    let sent = up.seen();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].header("cookie"), None);
    assert!(sent[0].target.contains("compileGroup=g&clsiserverid=s1"));
}

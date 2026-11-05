//! The Overleaf HTTP client against a stand-in for Overleaf and its CDN.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod common;

use common::{Reply, Upstream, response, serve};
use serde_json::{Value, json};
use wf_relay_server::overleaf_api::{Identity, OverleafApi};

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
        .compile(&identity("a=1"), "p1", "main.tex")
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
    let up = serve(vec![("/user/projects", vec![response(500, &[], b"boom")])]).await;
    let err = api(&up)
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert!(err.starts_with("500: "), "{err}");
    assert_eq!(up.seen().len(), 3);
}

#[tokio::test]
async fn forbidden_is_not_retried() {
    let up = serve(vec![(
        "/user/projects",
        vec![response(403, &[], b"denied")],
    )])
    .await;
    let err = api(&up)
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert_eq!(err, "403: denied");
    assert_eq!(up.seen().len(), 1);
}

#[tokio::test]
async fn bad_json_three_times_is_err() {
    let up = serve(vec![(
        "/user/projects",
        vec![response(200, &[], b"not json")],
    )])
    .await;
    let err = api(&up)
        .user_projects(&identity("a=1"))
        .await
        .expect_err("error");
    assert!(!err.is_empty());
    assert_eq!(up.seen().len(), 3);
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
async fn partial_content_is_concatenated() {
    let up = serve(vec![(
        "/build/output.pdf",
        vec![response(206, &[], b"ab"), response(200, &[], b"cd")],
    )])
    .await;
    let bytes = api(&up)
        .get_file_from_clsi(&identity("a=1"), "/build/output.pdf", "g", None, None)
        .await
        .expect("file");
    assert_eq!(bytes, b"abcd".to_vec());
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

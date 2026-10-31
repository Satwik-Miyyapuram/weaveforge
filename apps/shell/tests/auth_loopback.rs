#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]
//! Tests for the sign-in loopback listener: host and path rules, the answer and render, and the served flow.

use std::net::SocketAddr;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;
use weaveforge_shell::auth_loopback::{
    Reply, answer, callback_query, is_loopback_host, render, serve,
};

const GOOD: &str = "GET /auth/callback?code=a&state=b HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n";

#[test]
fn accepts_the_three_loopback_names() {
    assert!(is_loopback_host(Some("127.0.0.1:53682"), 53682));
    assert!(is_loopback_host(Some("localhost:53682"), 53682));
    assert!(is_loopback_host(Some("[::1]:53682"), 53682));
}

#[test]
fn trims_and_lowercases_the_host() {
    assert!(is_loopback_host(Some("LOCALHOST:53682"), 53682));
    assert!(is_loopback_host(Some("  127.0.0.1:53682 "), 53682));
}

#[test]
fn rejects_wrong_port_foreign_names_bare_ip_and_missing_host() {
    assert!(!is_loopback_host(Some("127.0.0.1:1234"), 53682));
    assert!(!is_loopback_host(Some("evil.com:53682"), 53682));
    assert!(!is_loopback_host(Some("127.0.0.1"), 53682));
    assert!(!is_loopback_host(None, 53682));
}

#[test]
fn callback_query_keeps_the_query_with_its_question_mark() {
    assert_eq!(
        callback_query("/auth/callback?code=a&state=b").as_deref(),
        Some("?code=a&state=b")
    );
}

#[test]
fn callback_query_drops_the_fragment() {
    assert_eq!(
        callback_query("/auth/callback?code=a#frag").as_deref(),
        Some("?code=a")
    );
}

#[test]
fn callback_query_needs_a_non_empty_query() {
    assert_eq!(callback_query("/auth/callback"), None);
    assert_eq!(callback_query("/auth/callback?"), None);
}

#[test]
fn callback_query_needs_the_exact_path() {
    assert_eq!(callback_query("/other?code=a"), None);
    assert_eq!(callback_query("/auth/callback/?code=a"), None);
}

#[test]
fn callback_query_rejects_an_empty_target() {
    assert_eq!(callback_query(""), None);
}

#[test]
fn good_request_is_answered_and_handed_over() {
    let (reply, query) = answer(GOOD);
    assert_eq!(reply.status, 200);
    assert_eq!(
        reply.headers,
        vec![
            ("content-type", "text/html; charset=utf-8"),
            ("cache-control", "no-store"),
        ]
    );
    assert!(reply.body.contains("You're signed in."));
    assert_eq!(query.as_deref(), Some("?code=a&state=b"));
}

#[test]
fn lowercase_host_header_is_accepted() {
    let head = "GET /auth/callback?code=a HTTP/1.1\r\nhost: localhost:53682\r\n\r\n";
    let (reply, query) = answer(head);
    assert_eq!(reply.status, 200);
    assert_eq!(query.as_deref(), Some("?code=a"));
}

#[test]
fn foreign_host_gets_404_and_nothing_is_handed_over() {
    let head = "GET /auth/callback?code=a HTTP/1.1\r\nHost: evil.com:53682\r\n\r\n";
    let (reply, query) = answer(head);
    assert_eq!(reply.status, 404);
    assert_eq!(reply.headers, vec![("content-type", "text/plain")]);
    assert_eq!(reply.body, "Not found");
    assert_eq!(query, None);
}

#[test]
fn missing_host_gets_404() {
    let head = "GET /auth/callback?code=a HTTP/1.1\r\n\r\n";
    let (reply, query) = answer(head);
    assert_eq!(reply.status, 404);
    assert_eq!(query, None);
}

#[test]
fn loopback_host_on_the_wrong_path_gets_404() {
    let head = "GET /other?code=a HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n";
    let (reply, query) = answer(head);
    assert_eq!(reply.status, 404);
    assert_eq!(query, None);
}

#[test]
fn render_writes_status_headers_and_body() {
    let (reply, _) = answer(GOOD);
    let text = String::from_utf8(render(&reply)).unwrap();
    assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(text.contains(&format!("content-length: {}\r\n", reply.body.len())));
    assert!(text.contains("connection: close\r\n\r\n"));
    assert!(text.ends_with(reply.body));
}

#[test]
fn render_uses_the_not_found_reason() {
    let reply = Reply {
        status: 404,
        headers: vec![("content-type", "text/plain")],
        body: "Not found",
    };
    let text = String::from_utf8(render(&reply)).unwrap();
    assert!(text.starts_with("HTTP/1.1 404 Not Found\r\n"));
    assert!(text.ends_with("\r\n\r\nNot found"));
}

async fn start() -> (SocketAddr, mpsc::UnboundedReceiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = mpsc::unbounded_channel();
    drop(tokio::spawn(serve(listener, move |query| {
        let _ = tx.send(query);
    })));
    (addr, rx)
}

/// Sends raw bytes and reads until the server closes; errors just leave what arrived.
async fn send(addr: SocketAddr, request: &[u8]) -> String {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    let _ = stream.write_all(request).await;
    let mut out = Vec::new();
    let _ = stream.read_to_end(&mut out).await;
    String::from_utf8_lossy(&out).into_owned()
}

#[tokio::test]
async fn serve_answers_and_hands_the_query_on() {
    let (addr, mut rx) = start().await;
    let reply = send(
        addr,
        b"GET /auth/callback?code=x HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n",
    )
    .await;
    assert!(reply.starts_with("HTTP/1.1 200 OK\r\n"));
    let query = timeout(Duration::from_secs(5), rx.recv()).await.unwrap();
    assert_eq!(query.as_deref(), Some("?code=x"));
}

#[tokio::test]
async fn serve_404_hands_nothing_on() {
    let (addr, mut rx) = start().await;
    let reply = send(
        addr,
        b"GET /other?code=x HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n",
    )
    .await;
    assert!(reply.starts_with("HTTP/1.1 404 Not Found\r\n"));
    assert!(
        timeout(Duration::from_millis(200), rx.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn serve_drops_an_oversized_head_without_reply_or_hand_over() {
    let (addr, mut rx) = start().await;
    let mut request = b"GET /auth/callback?code=".to_vec();
    request.extend(std::iter::repeat_n(b'a', 9000));
    let reply = send(addr, &request).await;
    assert!(reply.is_empty());
    assert!(
        timeout(Duration::from_millis(200), rx.recv())
            .await
            .is_err()
    );
}

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]
//! Tests for the sign-in loopback listener: host and path rules, the answer and render, and the served flow.

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;
use weaveforge_shell_lib::auth_loopback::{
    Reply, SignInPort, answer, bind_port, bind_with_retry, callback_query, ensure_listening,
    is_loopback_host, render, serve,
};

/// A short retry window for tests: the real one is seconds long.
const QUICK: [Duration; 3] = [
    Duration::from_millis(20),
    Duration::from_millis(40),
    Duration::from_millis(80),
];

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
fn post_callback_gets_405_with_allow_and_nothing_is_handed_over() {
    let head = "POST /auth/callback?code=a HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n";
    let (reply, query) = answer(head);
    assert_eq!(reply.status, 405);
    assert_eq!(
        reply.headers,
        vec![
            ("allow", "GET"),
            ("content-type", "text/html; charset=utf-8")
        ]
    );
    assert!(reply.body.contains("Sign-in failed"));
    assert_eq!(query, None);
}

#[test]
fn every_non_get_method_on_the_callback_is_refused() {
    for method in ["PUT", "HEAD", "DELETE", "PATCH", "OPTIONS"] {
        let head =
            format!("{method} /auth/callback?code=a HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n");
        let (reply, query) = answer(&head);
        assert_eq!(reply.status, 405, "{method} should be refused");
        assert_eq!(query, None, "{method} must not hand a sign-in on");
    }
}

#[test]
fn render_writes_status_headers_and_body() {
    let (reply, _) = answer(GOOD);
    let text = String::from_utf8(render(&reply)).unwrap();
    assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(text.contains(&format!("content-length: {}\r\n", reply.body.len())));
    assert!(text.contains("connection: close\r\n\r\n"));
    assert!(text.ends_with(reply.body.as_str()));
}

#[test]
fn render_uses_the_not_found_reason() {
    let reply = Reply {
        status: 404,
        headers: vec![("content-type", "text/plain")],
        body: "Not found".to_string(),
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
async fn serve_405_for_a_post_callback_hands_nothing_on() {
    let (addr, mut rx) = start().await;
    let reply = send(
        addr,
        b"POST /auth/callback?code=x HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n",
    )
    .await;
    assert!(reply.starts_with("HTTP/1.1 405 Method Not Allowed\r\n"));
    assert!(reply.contains("allow: GET\r\n"));
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

#[test]
fn sign_in_port_starts_not_listening_and_follows_the_bind() {
    let port = SignInPort::default();
    assert!(!port.listening());
    port.set_listening(true);
    assert!(port.listening());
    port.set_listening(false);
    assert!(!port.listening());
}

// --- Busy port, retries and on-demand listening ---

/// A listener on a free port this test owns, and that port.
async fn holder() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

#[tokio::test]
async fn bind_port_reports_a_busy_port_as_address_in_use() {
    let (_holder, port) = holder().await;
    let err = bind_port(port).await.unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);
}

#[tokio::test]
async fn bind_port_succeeds_once_the_port_is_free() {
    let (holder, port) = holder().await;
    drop(holder);
    assert!(bind_port(port).await.is_ok());
}

#[tokio::test]
async fn bind_with_retry_gets_the_port_when_it_frees_inside_the_window() {
    let (holder, port) = holder().await;
    drop(tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(60)).await;
        drop(holder);
    }));
    let listener = bind_with_retry(|| bind_port(port), &QUICK).await;
    assert!(listener.is_ok());
}

#[tokio::test]
async fn bind_with_retry_tries_once_per_delay_plus_one_then_gives_up() {
    let (_holder, port) = holder().await;
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&attempts);
    let result = bind_with_retry(
        move || {
            let _ = counter.fetch_add(1, Ordering::SeqCst);
            bind_port(port)
        },
        &QUICK,
    )
    .await;
    assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::AddrInUse);
    assert_eq!(attempts.load(Ordering::SeqCst), QUICK.len() + 1);
}

#[tokio::test]
async fn ensure_listening_reports_false_while_busy_then_recovers_on_demand() {
    let (holder, port) = holder().await;
    let state = SignInPort::default();
    let (tx, _rx) = mpsc::unbounded_channel::<String>();
    let serve_tx = tx.clone();
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&attempts);
    let bind = move || {
        let _ = counter.fetch_add(1, Ordering::SeqCst);
        bind_port(port)
    };
    let on_sign_in = move |q: String| {
        let _ = serve_tx.send(q);
    };

    assert!(!ensure_listening(&state, bind.clone(), &[], on_sign_in.clone()).await);
    assert!(!state.listening());

    drop(holder);
    assert!(ensure_listening(&state, bind.clone(), &[], on_sign_in.clone()).await);
    assert!(state.listening());
    assert_eq!(attempts.load(Ordering::SeqCst), 2);

    // Already up: no second bind, which would fail with the port now held by us.
    assert!(ensure_listening(&state, bind, &[], on_sign_in).await);
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn ensure_listening_serves_callbacks_once_bound() {
    let (listener, port) = holder().await;
    drop(listener);
    let state = SignInPort::default();
    let (tx, mut rx) = mpsc::unbounded_channel();
    assert!(
        ensure_listening(
            &state,
            move || bind_port(port),
            &QUICK,
            move |q: String| {
                let _ = tx.send(q);
            }
        )
        .await
    );
    // The host header names the shell's fixed port; the socket bound here is the test's own.
    let reply = send(
        format!("127.0.0.1:{port}").parse().unwrap(),
        GOOD.as_bytes(),
    )
    .await;
    assert!(reply.starts_with("HTTP/1.1 200 OK\r\n"));
    let query = timeout(Duration::from_secs(5), rx.recv()).await.unwrap();
    assert_eq!(query.as_deref(), Some("?code=a&state=b"));
}

// --- Callback pages ---

#[test]
fn the_signed_in_page_is_theme_neutral_and_asks_for_nothing_else() {
    let (reply, _) = answer(GOOD);
    assert!(reply.body.contains("Signed in — you can close this tab"));
    assert!(reply.body.contains("prefers-color-scheme: dark"));
    assert!(reply.body.contains("color-scheme: light dark"));
    // An empty data icon stops the browser asking for /favicon.ico.
    assert!(reply.body.contains(r#"rel="icon" href="data:,""#));
    assert!(!reply.body.contains("src="));
    assert!(!reply.body.contains("href=\"http"));
    assert!(!reply.body.contains("<script"));
}

#[test]
fn a_provider_refusal_gets_a_failure_page_with_the_reason_and_is_handed_on() {
    let head = "GET /auth/callback?error=access_denied&error_description=User+denied+access HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n";
    let (reply, query) = answer(head);
    assert_eq!(reply.status, 400);
    assert!(reply.body.contains("Sign-in failed: User denied access"));
    assert!(reply.body.contains("Return to WeaveForge"));
    assert_eq!(
        query.as_deref(),
        Some("?error=access_denied&error_description=User+denied+access")
    );
}

#[test]
fn a_refusal_without_a_description_names_the_error_code() {
    let head = "GET /auth/callback?error=server_error HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n";
    let (reply, _) = answer(head);
    assert!(reply.body.contains("Sign-in failed: server_error"));
}

#[test]
fn the_reason_on_a_failure_page_is_escaped() {
    let head = "GET /auth/callback?error=x&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n";
    let (reply, _) = answer(head);
    assert!(!reply.body.contains("<script>"));
    assert!(reply.body.contains("&lt;script&gt;"));
}

#[test]
fn a_callback_without_a_code_is_a_failure_page_and_hands_nothing_on() {
    for target in ["/auth/callback", "/auth/callback?state=only"] {
        let head = format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n");
        let (reply, query) = answer(&head);
        assert_eq!(reply.status, 400, "{target}");
        assert!(reply.body.contains("Sign-in failed"), "{target}");
        assert_eq!(query, None, "{target}");
    }
}

#[test]
fn a_favicon_or_stray_path_gets_404_and_nothing_is_handed_on() {
    let head = "GET /favicon.ico HTTP/1.1\r\nHost: 127.0.0.1:53682\r\n\r\n";
    let (reply, query) = answer(head);
    assert_eq!(reply.status, 404);
    assert_eq!(query, None);
}

#[test]
fn render_uses_the_bad_request_reason() {
    let reply = Reply {
        status: 400,
        headers: vec![("content-type", "text/html; charset=utf-8")],
        body: "<p>x</p>".to_string(),
    };
    let text = String::from_utf8(render(&reply)).unwrap();
    assert!(text.starts_with("HTTP/1.1 400 Bad Request\r\n"));
}

#[tokio::test]
async fn a_repeated_callback_is_answered_but_handed_over_once() {
    let (addr, mut rx) = start().await;
    let first = send(addr, GOOD.as_bytes()).await;
    let second = send(addr, GOOD.as_bytes()).await;
    assert!(first.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(second.starts_with("HTTP/1.1 200 OK\r\n"));
    assert_eq!(
        timeout(Duration::from_secs(5), rx.recv())
            .await
            .unwrap()
            .as_deref(),
        Some("?code=a&state=b")
    );
    assert!(
        timeout(Duration::from_millis(200), rx.recv())
            .await
            .is_err()
    );
}

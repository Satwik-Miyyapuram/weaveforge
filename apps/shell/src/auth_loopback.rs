//! Sign-in loopback: the one-shot HTTP listener a provider sign-in redirects back to.
//!
//! The reader's browser finishes the sign-in and is sent to
//! `http://127.0.0.1:53682/auth/callback?...`. This module answers that request
//! with a static page and hands the query string on to the app.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

/// Port the sign-in redirect comes back to.
pub const AUTH_LOOPBACK_PORT: u16 = 53682;
/// The one path the loopback listener answers on.
pub const AUTH_LOOPBACK_PATH: &str = "/auth/callback";
/// The event the page's onSignIn listens for; payload is the query string.
pub const SIGN_IN_EVENT: &str = "sign-in";

/// Most bytes read from a connection while waiting for the end of its request head.
const MAX_HEAD: usize = 8192;
/// How long a connection may take to send its request head.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// How long `serve` waits after a failed accept.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

/// What the browser tab is left showing. One self-contained page with no assets,
/// so the tab never waits on a request that will not arrive.
const DONE_PAGE: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signed in — WeaveForge</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #101014; color: #e9e9ee;
  }
  main { text-align: center; padding: 24px; }
  h1 { font-size: 1.35rem; margin: 0 0 8px; }
  p { margin: 0; opacity: 0.7; }
</style>
</head>
<body>
  <main>
    <h1>You're signed in.</h1>
    <p>WeaveForge has the rest. You can close this tab.</p>
  </main>
</body>
</html>"#;

/// True when a `Host` header names this listener: `127.0.0.1`, `localhost` or `[::1]` on `port`.
///
/// Anything else is a name this app never hands out, so it is refused.
#[must_use]
pub fn is_loopback_host(host: Option<&str>, port: u16) -> bool {
    host.is_some_and(|h| {
        let name = h.trim().to_ascii_lowercase();
        [
            format!("127.0.0.1:{port}"),
            format!("localhost:{port}"),
            format!("[::1]:{port}"),
        ]
        .contains(&name)
    })
}

/// The query string (with its leading `?`) of a sign-in callback target, or `None`.
///
/// `target` is the HTTP request-target in origin form. The path must be exactly
/// `AUTH_LOOPBACK_PATH` and the query must be non-empty; the fragment is dropped.
#[must_use]
pub fn callback_query(target: &str) -> Option<String> {
    let target = target.split_once('#').map_or(target, |(before, _)| before);
    if !target.starts_with('/') || target.starts_with("//") {
        return None;
    }
    let (path, query) = target.split_once('?')?;
    if path != AUTH_LOOPBACK_PATH || query.is_empty() {
        return None;
    }
    Some(format!("?{query}"))
}

/// A response to the loopback request: status, headers and body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    /// HTTP status code.
    pub status: u16,
    /// Response headers in send order.
    pub headers: Vec<(&'static str, &'static str)>,
    /// Response body.
    pub body: &'static str,
}

/// Answers one request head and returns the reply, plus the sign-in query to hand on if any.
///
/// `request_head` is the raw text up to the blank line. Only a loopback `Host` and
/// the callback path with a query get the page; everything else is a 404 and
/// nothing is handed on.
#[must_use]
pub fn answer(request_head: &str) -> (Reply, Option<String>) {
    let mut lines = request_head.lines();
    let request_line: Vec<&str> = lines.next().unwrap_or("").split(' ').collect();
    let target = match request_line.as_slice() {
        [_, target, _] => *target,
        _ => "",
    };
    let host = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("host").then_some(value.trim())
    });
    let query = if is_loopback_host(host, AUTH_LOOPBACK_PORT) {
        callback_query(target)
    } else {
        None
    };
    match query {
        Some(query) => (
            Reply {
                status: 200,
                headers: vec![
                    ("content-type", "text/html; charset=utf-8"),
                    ("cache-control", "no-store"),
                ],
                body: DONE_PAGE,
            },
            Some(query),
        ),
        None => (
            Reply {
                status: 404,
                headers: vec![("content-type", "text/plain")],
                body: "Not found",
            },
            None,
        ),
    }
}

/// The HTTP/1.1 bytes for `reply`, closing the connection after the body.
#[must_use]
pub fn render(reply: &Reply) -> Vec<u8> {
    let reason = match reply.status {
        200 => "OK",
        404 => "Not Found",
        _ => "",
    };
    let mut head = format!("HTTP/1.1 {} {reason}\r\n", reply.status);
    for (name, value) in &reply.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!(
        "content-length: {}\r\nconnection: close\r\n\r\n",
        reply.body.len()
    ));
    let mut bytes = head.into_bytes();
    bytes.extend_from_slice(reply.body.as_bytes());
    bytes
}

/// Accepts connections forever, answering each and handing a sign-in query to `on_sign_in`.
///
/// A connection that does not send its request head in time or within the size cap is dropped without a reply.
/// A failed accept (say, out of file handles) waits `ACCEPT_BACKOFF` before the next try, so it cannot spin.
pub async fn serve<F>(listener: TcpListener, on_sign_in: F)
where
    F: Fn(String) + Send + Sync + 'static,
{
    let on_sign_in = Arc::new(on_sign_in);
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            tokio::time::sleep(ACCEPT_BACKOFF).await;
            continue;
        };
        // Detached: each connection runs on its own; nothing waits for it.
        drop(tokio::spawn(handle(stream, Arc::clone(&on_sign_in))));
    }
}

async fn handle<F>(mut stream: TcpStream, on_sign_in: Arc<F>)
where
    F: Fn(String) + Send + Sync + 'static,
{
    let Ok(Some(head)) = timeout(READ_TIMEOUT, read_head(&mut stream)).await else {
        return;
    };
    let (reply, query) = answer(&String::from_utf8_lossy(&head));
    // Answer first, hand over second: the reader is looking at this tab, and the app taking focus mid-load reads as a hang.
    let _ = stream.write_all(&render(&reply)).await;
    let _ = stream.shutdown().await;
    if let Some(query) = query {
        on_sign_in(query);
    }
}

/// Reads until the blank line that ends a request head, or gives up at `MAX_HEAD` bytes.
async fn read_head(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut head = Vec::new();
    loop {
        if head.windows(4).any(|w| w == b"\r\n\r\n") {
            return Some(head);
        }
        if head.len() >= MAX_HEAD {
            return None;
        }
        let mut chunk = [0_u8; 1024];
        let room = (MAX_HEAD - head.len()).min(chunk.len());
        let read = stream.read(&mut chunk[..room]).await.ok()?;
        if read == 0 {
            return None;
        }
        head.extend_from_slice(&chunk[..read]);
    }
}

/// Binds the listener on `127.0.0.1` only.
///
/// # Errors
///
/// Fails when the port is already taken, usually by a second copy of the app.
pub async fn bind() -> std::io::Result<TcpListener> {
    // Explicitly loopback: 0.0.0.0 would expose this port to whatever network the machine is on.
    TcpListener::bind(("127.0.0.1", AUTH_LOOPBACK_PORT)).await
}

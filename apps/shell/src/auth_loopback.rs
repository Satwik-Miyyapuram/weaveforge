//! Sign-in loopback: the one-shot HTTP listener a provider sign-in redirects back to.
//!
//! The reader's browser finishes the sign-in and is sent to
//! `http://127.0.0.1:53682/auth/callback?...`. This module answers that request
//! with a static page and hands the query string on to the app.
//!
//! The listener starts at launch, like the Electron build's did, and is started
//! again on demand when the sign-in page asks, so a port that was busy at launch
//! (a second copy of the app, a leftover process) recovers without a restart.

use std::collections::HashSet;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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
/// Waits between bind attempts when the port is busy: about three and a half seconds in all.
pub const SIGN_IN_RETRY: [Duration; 3] = [
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
];

/// Most bytes read from a connection while waiting for the end of its request head.
const MAX_HEAD: usize = 8192;
/// How long a connection may take to send its request head.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// How long `serve` waits after a failed accept.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

/// Whether the sign-in listener holds its port, and the gate that stops two starts binding at once.
#[derive(Debug)]
pub struct SignInPort {
    listening: AtomicBool,
    gate: tokio::sync::Mutex<()>,
}

impl Default for SignInPort {
    fn default() -> Self {
        Self {
            listening: AtomicBool::new(false),
            gate: tokio::sync::Mutex::new(()),
        }
    }
}

impl SignInPort {
    /// Records whether the listener holds its port.
    pub fn set_listening(&self, listening: bool) {
        self.listening.store(listening, Ordering::Relaxed);
    }

    /// Whether a sign-in redirect can reach the app.
    #[must_use]
    pub fn listening(&self) -> bool {
        self.listening.load(Ordering::Relaxed)
    }
}

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

/// Splits an HTTP request-target into its path and its query (without the `?`), dropping any fragment.
#[must_use]
pub fn split_target(target: &str) -> (&str, &str) {
    let target = target.split_once('#').map_or(target, |(before, _)| before);
    target.split_once('?').unwrap_or((target, ""))
}

/// The query string (with its leading `?`) of a sign-in callback target, or `None`.
///
/// `target` is the HTTP request-target in origin form. The path must be exactly
/// `AUTH_LOOPBACK_PATH` and the query must be non-empty; the fragment is dropped.
#[must_use]
pub fn callback_query(target: &str) -> Option<String> {
    if !target.starts_with('/') || target.starts_with("//") {
        return None;
    }
    let (path, query) = split_target(target);
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
    pub body: String,
}

/// Answers one request head and returns the reply, plus the sign-in query to hand on if any.
///
/// `request_head` is the raw text up to the blank line. Only a loopback `Host` and
/// the callback path get a page; anything else is a 404. A callback sent with any
/// method other than `GET` is a 405. A callback that carries a provider error gets
/// a failure page and is handed on so the page can say why; one with no code gets
/// a failure page and nothing is handed on.
#[must_use]
pub fn answer(request_head: &str) -> (Reply, Option<String>) {
    let mut lines = request_head.lines();
    let request_line: Vec<&str> = lines.next().unwrap_or("").split(' ').collect();
    let (method, target) = match request_line.as_slice() {
        [method, target, _] => (*method, *target),
        _ => ("", ""),
    };
    let host = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("host").then_some(value.trim())
    });
    let (path, query) = split_target(target);
    if !is_loopback_host(host, AUTH_LOOPBACK_PORT) || path != AUTH_LOOPBACK_PATH {
        return (not_found(), None);
    }
    if method != "GET" {
        let reply = page(
            405,
            vec![
                ("allow", "GET"),
                ("content-type", "text/html; charset=utf-8"),
            ],
            "Sign-in failed",
            "This address only takes a browser visit.",
        );
        return (reply, None);
    }
    answer_callback(query)
}

/// The reply to a `GET` callback whose query string is `query`, and the query to hand on if any.
fn answer_callback(query: &str) -> (Reply, Option<String>) {
    let handed = (!query.is_empty()).then(|| format!("?{query}"));
    if let Some(code) = query_param(query, "error") {
        let reason = query_param(query, "error_description")
            .filter(|description| !description.trim().is_empty())
            .unwrap_or(code);
        return (failure_page(&reason), handed);
    }
    if query_param(query, "code").is_some_and(|code| !code.is_empty()) {
        return (done_page(), handed);
    }
    (failure_page("The provider sent no sign-in code."), None)
}

/// The first value of `name` in a query string, form-decoded, or `None` when absent.
fn query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (form_decode(key) == name).then(|| form_decode(value))
    })
}

/// Decodes `+` as a space and `%XX` escapes; a malformed escape is kept as written.
fn form_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => out.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                match (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])) {
                    (Some(high), Some(low)) => {
                        out.push(high * 16 + low);
                        index += 3;
                        continue;
                    }
                    _ => out.push(b'%'),
                }
            }
            byte => out.push(byte),
        }
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    (byte as char)
        .to_digit(16)
        .and_then(|digit| u8::try_from(digit).ok())
}

/// Escapes the characters that would let a reason change the page's markup.
fn escape_html(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#39;".to_string(),
            other => other.to_string(),
        })
        .collect()
}

fn not_found() -> Reply {
    Reply {
        status: 404,
        headers: vec![("content-type", "text/plain")],
        body: "Not found".to_string(),
    }
}

fn done_page() -> Reply {
    page(
        200,
        vec![
            ("content-type", "text/html; charset=utf-8"),
            ("cache-control", "no-store"),
        ],
        "You're signed in.",
        "WeaveForge has the rest.",
    )
}

fn failure_page(reason: &str) -> Reply {
    let heading = format!("Sign-in failed: {}", escape_html(reason));
    page(
        400,
        vec![
            ("content-type", "text/html; charset=utf-8"),
            ("cache-control", "no-store"),
        ],
        &heading,
        "Return to WeaveForge and try again.",
    )
}

/// A self-contained page with no assets: the tab never waits on a request that will not arrive.
///
/// `heading` must already be escaped when it carries reader or provider text.
fn page(
    status: u16,
    headers: Vec<(&'static str, &'static str)>,
    heading: &str,
    detail: &str,
) -> Reply {
    let title = if status == 200 {
        "Signed in — you can close this tab"
    } else {
        "Sign-in — WeaveForge"
    };
    let body = format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<style>
  :root {{ color-scheme: light dark; }}
  body {{
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #ffffff; color: #1b1b1f;
  }}
  @media (prefers-color-scheme: dark) {{
    body {{ background: #101014; color: #e9e9ee; }}
  }}
  main {{ text-align: center; padding: 24px; }}
  h1 {{ font-size: 1.35rem; margin: 0 0 8px; }}
  p {{ margin: 0; opacity: 0.7; }}
</style>
</head>
<body>
  <main>
    <h1>{heading}</h1>
    <p>{detail}</p>
  </main>
</body>
</html>"#
    );
    Reply {
        status,
        headers,
        body,
    }
}

/// The HTTP/1.1 bytes for `reply`, closing the connection after the body.
#[must_use]
pub fn render(reply: &Reply) -> Vec<u8> {
    let reason = match reply.status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
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
/// Each distinct query is handed on once: a repeated callback is answered again but
/// not passed on, because a provider code can only be redeemed once. A connection
/// that does not send its request head in time or within the size cap is dropped
/// without a reply. A failed accept waits `ACCEPT_BACKOFF` before the next try.
pub async fn serve<F>(listener: TcpListener, on_sign_in: F)
where
    F: Fn(String) + Send + Sync + 'static,
{
    let on_sign_in = Arc::new(on_sign_in);
    let handed = Arc::new(Mutex::new(HashSet::new()));
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            tokio::time::sleep(ACCEPT_BACKOFF).await;
            continue;
        };
        // Detached: each connection runs on its own; nothing waits for it.
        drop(tokio::spawn(handle(
            stream,
            Arc::clone(&on_sign_in),
            Arc::clone(&handed),
        )));
    }
}

async fn handle<F>(mut stream: TcpStream, on_sign_in: Arc<F>, handed: Arc<Mutex<HashSet<String>>>)
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
        let first_time = handed
            .lock()
            .is_ok_and(|mut seen| seen.insert(query.clone()));
        if first_time {
            on_sign_in(query);
        }
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

/// Binds `port` on `127.0.0.1` only. Fails with `AddrInUse` when another program holds it.
///
/// # Errors
/// The bind error, usually `AddrInUse`.
pub async fn bind_port(port: u16) -> std::io::Result<TcpListener> {
    // Explicitly loopback: 0.0.0.0 would expose this port to whatever network the machine is on.
    TcpListener::bind(("127.0.0.1", port)).await
}

/// Tries `bind` once, then again after each delay in `delays`, and returns the first success or the last error.
///
/// # Errors
/// The last bind error, once every attempt has failed.
pub async fn bind_with_retry<B, Fut>(
    mut bind: B,
    delays: &[Duration],
) -> std::io::Result<TcpListener>
where
    B: FnMut() -> Fut,
    Fut: Future<Output = std::io::Result<TcpListener>>,
{
    let mut result = bind().await;
    for delay in delays {
        if result.is_ok() {
            break;
        }
        tokio::time::sleep(*delay).await;
        result = bind().await;
    }
    result
}

/// Makes sure the listener holds its port, starting `serve` on it if not; returns whether it does.
///
/// A start that is already listening does nothing. A failed bind leaves `state`
/// unchanged, so the next call tries again.
pub async fn ensure_listening<B, Fut, F>(
    state: &SignInPort,
    bind: B,
    delays: &[Duration],
    on_sign_in: F,
) -> bool
where
    B: FnMut() -> Fut,
    Fut: Future<Output = std::io::Result<TcpListener>>,
    F: Fn(String) + Send + Sync + 'static,
{
    let _gate = state.gate.lock().await;
    if state.listening() {
        return true;
    }
    match bind_with_retry(bind, delays).await {
        Ok(listener) => {
            drop(tokio::spawn(serve(listener, on_sign_in)));
            state.set_listening(true);
            true
        }
        Err(_) => false,
    }
}

/// Whether a sign-in redirect can reach the app; starts the listener first if it is not up.
///
/// The sign-in page asks this when it opens, so a port that was busy at launch
/// is retried then.
///
/// # Errors
/// Never.
#[cfg(desktop)]
#[tauri::command]
#[specta::specta]
pub async fn sign_in_listening(
    app: tauri::AppHandle,
    port: tauri::State<'_, SignInPort>,
) -> Result<bool, crate::commands::ShellError> {
    let handle = app.clone();
    let listening = ensure_listening(
        &port,
        || bind_port(AUTH_LOOPBACK_PORT),
        &SIGN_IN_RETRY,
        move |query| crate::deliver_sign_in(&handle, query),
    )
    .await;
    Ok(listening)
}

/// Phones have no loopback port: the browser returns through an App Link instead, so this always answers yes.
///
/// # Errors
/// Never.
#[cfg(mobile)]
#[tauri::command]
#[specta::specta]
pub async fn sign_in_listening(
    _app: tauri::AppHandle,
    _port: tauri::State<'_, SignInPort>,
) -> Result<bool, crate::commands::ShellError> {
    Ok(true)
}

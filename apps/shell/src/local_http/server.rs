//! The local API's socket: bind, read one request, answer, close.
//!
//! Ported from the socket half of `apps/shell/sidecar/src/local-api-server.ts`.
//! One request per connection; every answer carries `Connection: close`.

use std::future::{Future, poll_fn};
use std::sync::Arc;
use std::task::Poll;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::time::timeout;

use super::{BoxFuture, LocalApiRequest, LocalApiResponse};

/// The socket the local API listens on. Matches `obsidian-local-rest-api`'s non-TLS port.
pub const LOCAL_API_PORT: u16 = 27123;

/// Bodies past this are refused rather than buffered.
pub const MAX_BODY: usize = 8 * 1024 * 1024;

/// Answers one request. Shared by every connection.
pub type Handler =
    Arc<dyn Fn(LocalApiRequest) -> BoxFuture<'static, LocalApiResponse> + Send + Sync>;

/// Most bytes read while waiting for the end of the request head (Node's default header cap).
const MAX_HEAD: usize = 16 * 1024;
/// How long a connection may take to send its request head (Node's `headersTimeout`).
const HEAD_TIMEOUT: Duration = Duration::from_secs(60);
/// How long a connection may take to send its body (Node's `requestTimeout`).
const BODY_TIMEOUT: Duration = Duration::from_secs(300);
/// How long a refused upload may keep arriving before the connection is dropped unanswered.
const MAX_REFUSAL_DRAIN: Duration = Duration::from_secs(30);
/// How long `serve` waits after a failed accept, so it cannot spin.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

/// True when a `Host` header names this computer by name: `127.0.0.1`, `localhost` or `[::1]` on `port`.
///
/// Anything else is a name this app never hands out (DNS rebinding), so it is refused.
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

/// Binds the listener on `127.0.0.1` only.
pub async fn bind(port: u16) -> std::io::Result<TcpListener> {
    // Explicitly loopback: 0.0.0.0 would expose the API to the whole network.
    TcpListener::bind(("127.0.0.1", port)).await
}

/// Accepts until `shutdown` turns true; each connection on its own tokio task.
pub async fn serve(listener: TcpListener, handler: Handler, mut shutdown: watch::Receiver<bool>) {
    let Ok(addr) = listener.local_addr() else {
        return;
    };
    let port = addr.port();
    loop {
        if *shutdown.borrow() {
            return;
        }
        let next = {
            let mut changed = std::pin::pin!(shutdown.changed());
            poll_fn(|cx| {
                // A dropped sender also stops the server, or it would spin on `changed`.
                if let Poll::Ready(result) = changed.as_mut().poll(cx) {
                    return Poll::Ready(if result.is_ok() {
                        Next::Check
                    } else {
                        Next::Stop
                    });
                }
                listener.poll_accept(cx).map(|accepted| match accepted {
                    Ok((stream, _)) => Next::Conn(stream),
                    Err(_) => Next::Retry,
                })
            })
            .await
        };
        match next {
            Next::Conn(stream) => drop(tokio::spawn(handle(stream, Arc::clone(&handler), port))),
            Next::Retry => tokio::time::sleep(ACCEPT_BACKOFF).await,
            Next::Check => {}
            Next::Stop => return,
        }
    }
}

/// What the accept loop woke for.
enum Next {
    Conn(TcpStream),
    Retry,
    Check,
    Stop,
}

/// The parts of a request head the answer depends on.
struct Head {
    method: String,
    url: String,
    host: Option<String>,
    authorization: Option<String>,
    content_length: Option<usize>,
    chunked: bool,
}

async fn handle(mut stream: TcpStream, handler: Handler, port: u16) {
    let Ok(Some(buf)) = timeout(HEAD_TIMEOUT, read_head(&mut stream)).await else {
        return;
    };
    let Some((head, head_len)) = parse_head(&buf) else {
        write_response(&mut stream, &LocalApiResponse::fail(400, "Bad request.")).await;
        return;
    };
    let mut body = buf[head_len..].to_vec();

    if !is_loopback_host(head.host.as_deref(), port) {
        let answer = LocalApiResponse::fail(421, "Not for this host.");
        refuse(&mut stream, unread(&head, body.len()), &answer).await;
        return;
    }
    if head.chunked {
        let answer = LocalApiResponse::fail(411, "Send a Content-Length.");
        refuse(&mut stream, unread(&head, body.len()), &answer).await;
        return;
    }
    let length = head.content_length.unwrap_or(0);
    if length > MAX_BODY {
        let answer = LocalApiResponse::fail(413, "That file is too large to accept.");
        refuse(&mut stream, unread(&head, body.len()), &answer).await;
        return;
    }

    body.truncate(length);
    let filled = body.len();
    body.resize(length, 0);
    if !matches!(
        timeout(BODY_TIMEOUT, stream.read_exact(&mut body[filled..])).await,
        Ok(Ok(_))
    ) {
        return;
    }
    // Lossy like TS's Buffer.toString("utf8"): bad bytes become U+FFFD.
    let text = String::from_utf8_lossy(&body).into_owned();

    let request = LocalApiRequest {
        method: head.method,
        url: head.url,
        authorization: head.authorization,
        body: text,
    };
    let response = (*handler)(request).await;
    write_response(&mut stream, &response).await;
}

/// Reads until the blank line ending the head, or until `MAX_HEAD` or EOF; may hold some body bytes too.
async fn read_head(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let mut chunk = [0_u8; 1024];
    while buf.len() < MAX_HEAD && !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..read]);
    }
    Some(buf)
}

/// The request head, and how many bytes of `bytes` it used. `None` when malformed or incomplete.
fn parse_head(bytes: &[u8]) -> Option<(Head, usize)> {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut parsed = httparse::Request::new(&mut headers);
    let head_len = match parsed.parse(bytes).ok()? {
        httparse::Status::Complete(n) => n,
        httparse::Status::Partial => return None,
    };
    let mut head = Head {
        method: parsed.method?.to_owned(),
        url: parsed.path?.to_owned(),
        host: None,
        authorization: None,
        content_length: None,
        chunked: false,
    };
    for header in parsed.headers.iter() {
        let name = header.name;
        let value = std::str::from_utf8(header.value).ok()?;
        // First of a repeated header wins, as in Node.
        if name.eq_ignore_ascii_case("host") {
            if head.host.is_none() {
                head.host = Some(value.to_owned());
            }
        } else if name.eq_ignore_ascii_case("authorization") {
            if head.authorization.is_none() {
                head.authorization = Some(value.to_owned());
            }
        } else if name.eq_ignore_ascii_case("content-length") {
            // Two lengths are a request-smuggling shape, so refuse it.
            if head.content_length.is_some() {
                return None;
            }
            head.content_length = Some(value.trim().parse().ok()?);
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            head.chunked |= value.to_ascii_lowercase().contains("chunked");
        }
    }
    Some((head, head_len))
}

/// Body bytes still to come: `None` when the length is unknown (chunked, read to EOF).
fn unread(head: &Head, buffered: usize) -> Option<usize> {
    if head.chunked {
        None
    } else {
        Some(head.content_length.unwrap_or(0).saturating_sub(buffered))
    }
}

/// Sends a refusal only after the rest of the request is read: a close with unread bytes resets the answer away.
async fn refuse(stream: &mut TcpStream, unread: Option<usize>, answer: &LocalApiResponse) {
    if timeout(MAX_REFUSAL_DRAIN, discard(stream, unread))
        .await
        .is_ok()
    {
        write_response(stream, answer).await;
    }
}

/// Reads and drops `left` more request bytes, or to EOF when `None`.
async fn discard(stream: &mut TcpStream, mut left: Option<usize>) {
    let mut chunk = [0_u8; 8192];
    while left != Some(0) {
        let room = left.map_or(chunk.len(), |n| n.min(chunk.len()));
        match stream.read(&mut chunk[..room]).await {
            Ok(0) | Err(_) => return,
            Ok(n) => left = left.map(|l| l.saturating_sub(n)),
        }
    }
}

/// Writes the HTTP/1.1 answer, then closes our side.
async fn write_response(stream: &mut TcpStream, answer: &LocalApiResponse) {
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        answer.status,
        reason(answer.status),
        answer.content_type,
        answer.body.len(),
    );
    let mut bytes = head.into_bytes();
    bytes.extend_from_slice(answer.body.as_bytes());
    let _ = stream.write_all(&bytes).await;
    let _ = stream.shutdown().await;
}

/// The reason phrase for the statuses this API uses.
fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Payload Too Large",
        421 => "Misdirected Request",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    fn run<F: Future<Output = ()>>(future: F) {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future);
    }

    /// Echoes `method url authorization body`, so every field is checked at once.
    fn echo_handler() -> Handler {
        Arc::new(
            |req: LocalApiRequest| -> BoxFuture<'static, LocalApiResponse> {
                Box::pin(async move {
                    let body = format!(
                        "{} {} {} {}",
                        req.method,
                        req.url,
                        req.authorization.unwrap_or_default(),
                        req.body
                    );
                    LocalApiResponse {
                        status: 200,
                        content_type: "text/plain",
                        body,
                    }
                })
            },
        )
    }

    /// Binds port 0 and serves in the background; the sender keeps the server running.
    async fn start(handler: Handler) -> (u16, watch::Sender<bool>) {
        let listener = bind(0).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (stop, rx) = watch::channel(false);
        drop(tokio::spawn(serve(listener, handler, rx)));
        (port, stop)
    }

    /// Sends raw bytes, half-closes, and reads the answer to EOF.
    async fn exchange(port: u16, request: &[u8]) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(request).await.unwrap();
        stream.shutdown().await.unwrap();
        let mut out = Vec::new();
        let _ = stream.read_to_end(&mut out).await.unwrap();
        String::from_utf8_lossy(&out).into_owned()
    }

    #[test]
    fn echoes_method_url_authorization_and_body() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            let request = format!(
                "POST /api/x?y=1 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer abc\r\nContent-Length: 5\r\n\r\nhello"
            );
            let out = exchange(port, request.as_bytes()).await;
            assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
            assert!(out.contains("\r\nConnection: close\r\n"), "{out}");
            assert!(
                out.ends_with("\r\n\r\nPOST /api/x?y=1 Bearer abc hello"),
                "{out}"
            );
        });
    }

    #[test]
    fn content_type_carries_charset() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            let request = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
            let out = exchange(port, request.as_bytes()).await;
            assert!(
                out.contains("\r\nContent-Type: text/plain; charset=utf-8\r\n"),
                "{out}"
            );
        });
    }

    #[test]
    fn answers_carry_no_cors_header() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            let request = format!(
                "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.test\r\n\r\n"
            );
            let out = exchange(port, request.as_bytes()).await;
            assert!(
                !out.to_ascii_lowercase().contains("access-control"),
                "{out}"
            );
        });
    }

    #[test]
    fn foreign_host_is_421() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            let request = "GET / HTTP/1.1\r\nHost: evil.com\r\n\r\n";
            let out = exchange(port, request.as_bytes()).await;
            assert!(
                out.starts_with("HTTP/1.1 421 Misdirected Request\r\n"),
                "{out}"
            );
            assert!(out.ends_with("Not for this host.\"}"), "{out}");
        });
    }

    #[test]
    fn missing_host_is_421() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            let out = exchange(port, b"GET / HTTP/1.1\r\n\r\n").await;
            assert!(out.starts_with("HTTP/1.1 421 "), "{out}");
        });
    }

    #[test]
    fn oversize_content_length_is_413_after_drain() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            // Declared oversize, only a little sent; the server reads to our EOF, then answers.
            let request = format!(
                "POST /up HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {}\r\n\r\nsmall",
                MAX_BODY + 1
            );
            let out = exchange(port, request.as_bytes()).await;
            assert!(
                out.starts_with("HTTP/1.1 413 Payload Too Large\r\n"),
                "{out}"
            );
            assert!(
                out.ends_with("That file is too large to accept.\"}"),
                "{out}"
            );
        });
    }

    #[test]
    fn chunked_is_411() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            let request = format!(
                "POST /x HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n"
            );
            let out = exchange(port, request.as_bytes()).await;
            assert!(out.starts_with("HTTP/1.1 411 Length Required\r\n"), "{out}");
            assert!(out.ends_with("Send a Content-Length.\"}"), "{out}");
        });
    }

    #[test]
    fn non_utf8_body_bytes_become_replacement_chars() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            let mut request =
                format!("POST /x HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 1\r\n\r\n")
                    .into_bytes();
            request.push(0xff);
            let out = exchange(port, &request).await;
            assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
            assert!(out.ends_with("POST /x  \u{fffd}"), "{out}");
        });
    }

    #[test]
    fn malformed_head_is_400() {
        run(async {
            let (port, _stop) = start(echo_handler()).await;
            let out = exchange(port, b"NOT HTTP\r\n\r\n").await;
            assert!(out.starts_with("HTTP/1.1 400 Bad Request\r\n"), "{out}");
            assert!(out.ends_with("Bad request.\"}"), "{out}");
        });
    }

    #[test]
    fn serve_returns_once_shutdown_is_sent() {
        run(async {
            let listener = bind(0).await.unwrap();
            let (stop, rx) = watch::channel(false);
            let task = tokio::spawn(serve(listener, echo_handler(), rx));
            stop.send(true).unwrap();
            task.await.unwrap();
        });
    }

    #[test]
    fn loopback_host_cases() {
        assert!(is_loopback_host(Some("127.0.0.1:27123"), LOCAL_API_PORT));
        assert!(is_loopback_host(Some("  LocalHost:27123 "), LOCAL_API_PORT));
        assert!(is_loopback_host(Some("[::1]:27123"), LOCAL_API_PORT));
        assert!(!is_loopback_host(Some("127.0.0.1:27124"), LOCAL_API_PORT));
        assert!(!is_loopback_host(Some("localhost"), LOCAL_API_PORT));
        assert!(!is_loopback_host(Some("evil.com:27123"), LOCAL_API_PORT));
        assert!(!is_loopback_host(None, LOCAL_API_PORT));
    }
}

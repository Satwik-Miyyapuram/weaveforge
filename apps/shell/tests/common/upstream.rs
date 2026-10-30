//! A local stand-in for an upstream server, for the relay tests.
//!
//! A test file uses it as `#[path = "common/upstream.rs"] mod upstream;`
//! below its `#![allow(clippy::unwrap_used, clippy::expect_used)]` line.
#![allow(dead_code, reason = "each relay test uses a different subset")]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// What the server answers on one path.
#[derive(Clone, Debug)]
pub enum Reply {
    /// A whole raw response: status line, headers, blank line, body.
    /// `{port}` in the head is replaced by the server's port.
    Raw(Vec<u8>),
    /// The head only (status line and headers, no blank-line terminator needed);
    /// the connection then stays open and the body never comes.
    HeadThenStall(String),
    /// Read the request and never answer.
    Silent,
}

/// One request the server saw.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seen {
    /// The method, as sent.
    pub method: String,
    /// Path and query, as sent.
    pub target: String,
    /// Header names in lower case, values as sent, in order.
    pub headers: Vec<(String, String)>,
    /// The body (read by content-length).
    pub body: Vec<u8>,
}

impl Seen {
    /// The first value of header `name` (lower case).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }
}

/// A full response with `Content-Length` and `Connection: close` added.
pub fn response(status: u16, headers: &[(&str, &str)], body: &[u8]) -> Reply {
    let mut head = format!("HTTP/1.1 {status} X\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    ));
    let mut raw = head.into_bytes();
    raw.extend_from_slice(body);
    Reply::Raw(raw)
}

/// A 302 to `to` (`{port}` is replaced).
pub fn redirect(to: &str) -> Reply {
    response(302, &[("Location", to)], b"")
}

/// The running server.
pub struct Upstream {
    /// `http://127.0.0.1:{port}/`
    pub base: Url,
    /// The port it listens on.
    pub port: u16,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl Upstream {
    /// Every request so far, in order.
    pub fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }

    /// `base` joined with `path` (which may carry a query).
    pub fn url(&self, path: &str) -> Url {
        self.base.join(path).unwrap()
    }
}

type Routes = Arc<Vec<(&'static str, Vec<Reply>)>>;

/// Serves `routes` on 127.0.0.1. A route matches when its path equals the request
/// target, or the target's part before `?`. Several replies on one route are given
/// in turn and the last one repeats. No match: 404.
pub async fn serve(routes: Vec<(&'static str, Vec<Reply>)>) -> Upstream {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let routes: Routes = Arc::new(routes);
    let turns = Arc::new(Mutex::new(HashMap::<usize, usize>::new()));
    let log = Arc::clone(&seen);
    drop(tokio::spawn(async move {
        while let Ok((sock, _)) = listener.accept().await {
            let (routes, turns, log) = (Arc::clone(&routes), Arc::clone(&turns), Arc::clone(&log));
            drop(tokio::spawn(answer(sock, port, routes, turns, log)));
        }
    }));
    Upstream {
        base: Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap(),
        port,
        seen,
    }
}

async fn answer(
    mut sock: TcpStream,
    port: u16,
    routes: Routes,
    turns: Arc<Mutex<HashMap<usize, usize>>>,
    log: Arc<Mutex<Vec<Seen>>>,
) {
    let Some(seen) = read_request(&mut sock).await else {
        return;
    };
    let path = seen.target.split('?').next().unwrap_or("").to_string();
    log.lock().unwrap().push(seen.clone());
    let found = routes
        .iter()
        .position(|(p, _)| *p == seen.target || *p == path);
    let reply = match found {
        Some(i) => {
            let replies = &routes[i].1;
            let mut turns = turns.lock().unwrap();
            let turn = turns.entry(i).or_insert(0);
            let reply = replies[(*turn).min(replies.len() - 1)].clone();
            *turn += 1;
            reply
        }
        None => response(404, &[], b""),
    };
    match reply {
        Reply::Raw(raw) => {
            let text = String::from_utf8_lossy(&raw);
            let raw = if text.contains("{port}") {
                text.replace("{port}", &port.to_string()).into_bytes()
            } else {
                raw
            };
            let _ = sock.write_all(&raw).await;
            let _ = sock.shutdown().await;
        }
        Reply::HeadThenStall(head) => {
            let head = format!("{}\r\n\r\n", head.trim_end());
            let _ = sock.write_all(head.as_bytes()).await;
            tokio::time::sleep(Duration::from_secs(600)).await;
        }
        Reply::Silent => tokio::time::sleep(Duration::from_secs(600)).await,
    }
}

async fn read_request(sock: &mut TcpStream) -> Option<Seen> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        let n = sock.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let target = first.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(n, v)| (n.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let length: usize = headers
        .iter()
        .find(|(n, _)| n == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    let mut body = buf[end + 4..].to_vec();
    while body.len() < length {
        let n = sock.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    Some(Seen {
        method,
        target,
        headers,
        body,
    })
}

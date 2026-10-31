//! Tests for the safe fetch and the paste fetches (ported from apps/web/src/backend/net/safe-fetch.ts and fetch-for-paste.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use weaveforge_shell::fetch::paste::{NOT_A_PAGE, NOT_AN_IMAGE};
use weaveforge_shell::fetch::remote::{TitleReply, fetch_image_via, fetch_title_via};
use weaveforge_shell::fetch::safe::{
    BROWSER_AGENT, FailKind, FetchOptions, Network, PublicNetwork, TOO_SLOW, check_reachable,
    mb_label, parse_fetch_input, safe_fetch_via,
};
use weaveforge_shell::fetch::url_shape::{
    DEFAULT_FETCH_LIMITS, FetchLimits, UrlRejection, describe_rejection,
};

/// Replaces DNS, the address rule and the shape rule. Hosts come from a map.
struct TestNet {
    map: HashMap<String, Vec<String>>,
    allowed: fn(&str) -> bool,
}

impl Network for TestNet {
    async fn resolve(&self, host: &str) -> Result<Vec<String>, String> {
        self.map
            .get(host)
            .cloned()
            .ok_or_else(|| "no such host".to_owned())
    }

    fn is_allowed(&self, address: &str) -> bool {
        (self.allowed)(address)
    }

    fn shape(&self, url: &Url) -> Result<(), UrlRejection> {
        match url.scheme() {
            "http" | "https" => Ok(()),
            _ => Err(UrlRejection::Scheme),
        }
    }
}

fn loopback_only(address: &str) -> bool {
    address == "127.0.0.1"
}

fn test_net() -> TestNet {
    let mut map = HashMap::new();
    let _ = map.insert("site.test".to_owned(), vec!["127.0.0.1".to_owned()]);
    let _ = map.insert("inner.test".to_owned(), vec!["10.0.0.1".to_owned()]);
    let _ = map.insert(
        "mixed.test".to_owned(),
        vec!["127.0.0.1".to_owned(), "10.0.0.1".to_owned()],
    );
    let _ = map.insert("empty.test".to_owned(), Vec::new());
    TestNet {
        map,
        allowed: loopback_only,
    }
}

fn options(max_redirects: usize, max_bytes: usize, timeout_ms: u64) -> FetchOptions {
    FetchOptions {
        accept: "*/*".to_owned(),
        limits: FetchLimits {
            max_redirects,
            max_bytes,
            timeout: Duration::from_millis(timeout_ms),
        },
    }
}

fn defaults() -> FetchOptions {
    FetchOptions {
        accept: "*/*".to_owned(),
        limits: DEFAULT_FETCH_LIMITS,
    }
}

/// A canned response: status, headers, body; Content-Length is sent.
#[derive(Clone)]
struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    content_length: bool,
    hang: bool,
}

fn canned(status: u16, headers: &[(&str, &str)], body: &[u8]) -> Reply {
    Reply {
        status,
        headers: headers
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect(),
        body: body.to_vec(),
        content_length: true,
        hang: false,
    }
}

fn close_delimited(status: u16, headers: &[(&str, &str)], body: &[u8]) -> Reply {
    Reply {
        content_length: false,
        ..canned(status, headers, body)
    }
}

fn hanging() -> Reply {
    Reply {
        hang: true,
        ..canned(200, &[], b"")
    }
}

fn render(reply: &Reply) -> Vec<u8> {
    let mut head = format!("HTTP/1.1 {} Test\r\n", reply.status);
    for (name, value) in &reply.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if reply.content_length {
        head.push_str(&format!("Content-Length: {}\r\n", reply.body.len()));
    }
    head.push_str("Connection: close\r\n\r\n");
    let mut out = head.into_bytes();
    out.extend_from_slice(&reply.body);
    out
}

/// Reads the request head up to the blank line.
async fn read_head(stream: &mut TcpStream) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(chunk.get(..n).unwrap_or(&[])),
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

async fn handle(
    mut stream: TcpStream,
    routes: Arc<HashMap<String, Reply>>,
    seen: Arc<Mutex<Vec<String>>>,
) {
    let head = read_head(&mut stream).await;
    let path = head
        .lines()
        .next()
        .unwrap_or("")
        .split(' ')
        .nth(1)
        .unwrap_or("")
        .to_owned();
    let reply = routes
        .get(&path)
        .cloned()
        .unwrap_or_else(|| canned(404, &[], b"not found"));
    seen.lock().unwrap().push(head);
    if reply.hang {
        tokio::time::sleep(Duration::from_secs(30)).await;
        return;
    }
    let _ = stream.write_all(&render(&reply)).await;
    let _ = stream.shutdown().await;
}

/// A local HTTP/1.1 server on 127.0.0.1 that serves canned replies by path.
struct Server {
    port: u16,
    seen: Arc<Mutex<Vec<String>>>,
}

impl Server {
    async fn start(entries: Vec<(&str, Reply)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let routes: Arc<HashMap<String, Reply>> = Arc::new(
            entries
                .into_iter()
                .map(|(path, reply)| (path.to_owned(), reply))
                .collect(),
        );
        let seen = Arc::new(Mutex::new(Vec::new()));
        let accept_seen = Arc::clone(&seen);
        let _server = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let _conn = tokio::spawn(handle(
                    stream,
                    Arc::clone(&routes),
                    Arc::clone(&accept_seen),
                ));
            }
        });
        Self { port, seen }
    }

    fn url(&self, path: &str) -> String {
        format!("http://site.test:{}{path}", self.port)
    }

    fn requests(&self) -> Vec<String> {
        self.seen.lock().unwrap().clone()
    }
}

/// The value of a header in a raw request head; the name matches case-insensitively.
fn header_value(head: &str, name: &str) -> Option<String> {
    head.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then(|| value.trim().to_owned())
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ok_body() {
    let server = Server::start(vec![(
        "/ok",
        canned(200, &[("Content-Type", "text/html")], b"hi"),
    )])
    .await;
    let fetched = safe_fetch_via(&test_net(), &server.url("/ok"), &defaults())
        .await
        .unwrap();
    assert_eq!(fetched.body, b"hi".to_vec());
    assert_eq!(fetched.status, 200);
    assert_eq!(fetched.content_type, "text/html");
    assert_eq!(fetched.url, server.url("/ok"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pinned() {
    let server = Server::start(vec![("/p", canned(200, &[], b"ok"))]).await;
    let _ = safe_fetch_via(&test_net(), &server.url("/p"), &defaults())
        .await
        .unwrap();
    let heads = server.requests();
    assert_eq!(heads.len(), 1);
    let host = heads.first().and_then(|h| header_value(h, "Host"));
    assert_eq!(host, Some(format!("site.test:{}", server.port)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn headers_sent() {
    let server = Server::start(vec![("/h", canned(200, &[], b"ok"))]).await;
    let opts = FetchOptions {
        accept: "text/html".to_owned(),
        limits: DEFAULT_FETCH_LIMITS,
    };
    let _ = safe_fetch_via(&test_net(), &server.url("/h"), &opts)
        .await
        .unwrap();
    let heads = server.requests();
    let head = heads.first().cloned().unwrap_or_default();
    assert_eq!(
        header_value(&head, "User-Agent"),
        Some(BROWSER_AGENT.to_owned())
    );
    assert_eq!(header_value(&head, "Accept"), Some("text/html".to_owned()));
    assert_eq!(
        header_value(&head, "Accept-Language"),
        Some("en-US,en;q=0.9".to_owned())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn redirect_followed() {
    let server = Server::start(vec![
        ("/a", canned(302, &[("Location", "/b")], b"")),
        ("/b", canned(200, &[], b"done")),
    ])
    .await;
    let fetched = safe_fetch_via(&test_net(), &server.url("/a"), &defaults())
        .await
        .unwrap();
    assert_eq!(fetched.url, server.url("/b"));
    assert_eq!(fetched.body, b"done".to_vec());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn redirect_to_private() {
    // The private hop is refused before any dial, so the port is irrelevant here.
    let server = Server::start(vec![(
        "/r",
        canned(302, &[("Location", "http://inner.test/x")], b""),
    )])
    .await;
    let f = safe_fetch_via(&test_net(), &server.url("/r"), &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Refused);
    assert_eq!(f.status, 400);
    assert_eq!(f.message, describe_rejection(UrlRejection::PrivateAddress));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn redirect_nowhere() {
    let server = Server::start(vec![("/n", canned(302, &[], b""))]).await;
    let f = safe_fetch_via(&test_net(), &server.url("/n"), &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Upstream);
    assert_eq!(f.status, 502);
    assert_eq!(f.message, "That site redirected to nowhere.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn too_many_redirects() {
    let server = Server::start(vec![("/loop", canned(302, &[("Location", "/loop")], b""))]).await;
    let f = safe_fetch_via(&test_net(), &server.url("/loop"), &options(2, 1000, 10_000))
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Upstream);
    assert_eq!(f.status, 502);
    assert_eq!(f.message, "That address redirected too many times.");
    assert_eq!(server.requests().len(), 3);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn status_403() {
    let server = Server::start(vec![("/s", canned(403, &[], b"no"))]).await;
    let f = safe_fetch_via(&test_net(), &server.url("/s"), &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Upstream);
    assert_eq!(f.status, 403);
    assert_eq!(
        f.message,
        "Could not read that page: the site blocked automated access."
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn status_404() {
    let server = Server::start(vec![("/s", canned(404, &[], b"no"))]).await;
    let f = safe_fetch_via(&test_net(), &server.url("/s"), &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Upstream);
    assert_eq!(f.status, 404);
    assert_eq!(
        f.message,
        "Could not read that page: the page was not found."
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn status_500() {
    let server = Server::start(vec![("/s", canned(500, &[], b"no"))]).await;
    let f = safe_fetch_via(&test_net(), &server.url("/s"), &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Upstream);
    assert_eq!(f.status, 500);
    assert_eq!(f.message, "Could not read that page: it answered 500.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn too_large_declared() {
    let big = vec![b'x'; 2000];
    let server = Server::start(vec![("/big", canned(200, &[], &big))]).await;
    let f = safe_fetch_via(&test_net(), &server.url("/big"), &options(4, 1000, 10_000))
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::TooLarge);
    assert_eq!(f.status, 413);
    assert_eq!(f.message, "That file is over the 0 MB limit.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn too_large_streamed() {
    let big = vec![b'x'; 1500];
    let server = Server::start(vec![("/big", close_delimited(200, &[], &big))]).await;
    let f = safe_fetch_via(&test_net(), &server.url("/big"), &options(4, 1000, 10_000))
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::TooLarge);
    assert_eq!(f.status, 413);
    assert_eq!(f.message, "That file is over the 0 MB limit.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn exactly_max_ok() {
    let body = vec![b'y'; 1000];
    let server = Server::start(vec![("/max", canned(200, &[], &body))]).await;
    let fetched = safe_fetch_via(&test_net(), &server.url("/max"), &options(4, 1000, 10_000))
        .await
        .unwrap();
    assert_eq!(fetched.body.len(), 1000);
}

#[test]
fn mb_label_rounds_half_up() {
    assert_eq!(mb_label(524_288), 1);
    assert_eq!(mb_label(1000), 0);
    assert_eq!(mb_label(1_048_576), 1);
    assert_eq!(mb_label(12 * 1_048_576), 12);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unresolvable() {
    let f = safe_fetch_via(&test_net(), "http://gone.test/", &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Unreachable);
    assert_eq!(f.status, 502);
    assert_eq!(
        f.message,
        "That host could not be resolved: gone.test (no such host)."
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_resolve() {
    let f = safe_fetch_via(&test_net(), "http://empty.test/", &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Unreachable);
    assert_eq!(f.status, 502);
    assert_eq!(f.message, "That host could not be resolved.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn any_private_refused() {
    let f = safe_fetch_via(&test_net(), "http://mixed.test/", &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Refused);
    assert_eq!(f.status, 400);
    assert_eq!(f.message, describe_rejection(UrlRejection::PrivateAddress));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn not_a_url() {
    let f = safe_fetch_via(&test_net(), "", &defaults())
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Refused);
    assert_eq!(f.status, 400);
    assert_eq!(f.message, describe_rejection(UrlRejection::NotAUrl));
}

#[test]
fn parse_fetch_input_cases() {
    let port_form = parse_fetch_input("example.com:8443/x").unwrap();
    assert_eq!(port_form.scheme(), "https");
    assert_eq!(port_form.port(), Some(8443));
    let local = parse_fetch_input("localhost:3000").unwrap();
    assert_eq!(local.scheme(), "https");
    assert_eq!(local.host_str(), Some("localhost"));
    assert_eq!(parse_fetch_input("mailto:x").unwrap().scheme(), "mailto");
    assert_eq!(parse_fetch_input("HTTP://A.B").unwrap().scheme(), "http");
    assert_eq!(parse_fetch_input("  "), None);
    assert_eq!(parse_fetch_input("a:"), Url::parse("a:").ok());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn timeout() {
    let server = Server::start(vec![("/slow", hanging())]).await;
    let f = safe_fetch_via(&test_net(), &server.url("/slow"), &options(4, 1000, 300))
        .await
        .unwrap_err();
    assert_eq!(f.kind, FailKind::Unreachable);
    let timed_out_in_hop = format!(
        "That site could not be reached: site.test:{} ({TOO_SLOW}).",
        server.port
    );
    let budget_spent = TOO_SLOW;
    assert!(
        (f.status == 502 && f.message == timed_out_in_hop)
            || (f.status == 504 && f.message == budget_spent),
        "unexpected failure: {} {}",
        f.status,
        f.message
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_reachable_first_address() {
    let url = Url::parse("http://site.test/").unwrap();
    let address = check_reachable(&test_net(), &url).await.unwrap();
    assert_eq!(address, "127.0.0.1".parse::<IpAddr>().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn title_ok() {
    let server = Server::start(vec![(
        "/t",
        canned(
            200,
            &[("Content-Type", "text/html")],
            b"<title>Hello</title>",
        ),
    )])
    .await;
    let reply = fetch_title_via(&test_net(), &server.url("/t")).await;
    assert_eq!(
        reply,
        Ok(TitleReply {
            title: "Hello".to_owned(),
            url: server.url("/t"),
        })
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn title_not_page() {
    let server = Server::start(vec![(
        "/pdf",
        canned(200, &[("Content-Type", "application/pdf")], b"%PDF"),
    )])
    .await;
    let reply = fetch_title_via(&test_net(), &server.url("/pdf")).await;
    assert_eq!(reply, Err(NOT_A_PAGE.message.to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn image_ok() {
    let server = Server::start(vec![(
        "/img",
        canned(200, &[("Content-Type", "image/PNG; charset=x")], &[1, 2, 3]),
    )])
    .await;
    let image = fetch_image_via(&test_net(), &server.url("/img"))
        .await
        .unwrap();
    assert_eq!(image.content_type, "image/png");
    assert_eq!(image.bytes, "AQID");
    assert_eq!(image.url, server.url("/img"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn image_svg_refused() {
    let server = Server::start(vec![(
        "/svg",
        canned(200, &[("Content-Type", "image/svg+xml")], b"<svg/>"),
    )])
    .await;
    let err = fetch_image_via(&test_net(), &server.url("/svg"))
        .await
        .err();
    assert_eq!(err, Some(NOT_AN_IMAGE.message.to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn public_network_shape() {
    let localhost = Url::parse("http://localhost/").unwrap();
    assert!(PublicNetwork.shape(&localhost).is_err());
    assert!(!PublicNetwork.is_allowed("10.0.0.1"));
    assert!(PublicNetwork.is_allowed("1.1.1.1"));
    assert_eq!(
        PublicNetwork.resolve("127.0.0.1").await,
        Ok(vec!["127.0.0.1".to_owned()])
    );
    assert_eq!(
        PublicNetwork.resolve("[::1]").await,
        Ok(vec!["::1".to_owned()])
    );
}

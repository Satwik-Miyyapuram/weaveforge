//! Tests for the helpers every relay shares (ported from proxy-shared.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::error::Error;
use std::fmt;
use std::sync::{Arc, Mutex};

use reqwest::Url;
use reqwest::header::{HeaderMap, HeaderValue};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use weaveforge_shell::relay::shared::{
    Hop, MAX_REDIRECTS, fetch_checked_hops, is_public_https_url, next_hop, refuse, relay_client,
    upstream_failed,
};

#[test]
fn refusal_body_is_json_error() {
    assert_eq!(refuse(400, "x").body(), r#"{"error":"x"}"#);

    let text = r#"say "hi" \ there"#;
    let body = refuse(500, text).body();
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["error"], text);

    assert_eq!(refuse(418, "x").status, 418);
}

#[derive(Debug)]
struct Cause(&'static str);

impl fmt::Display for Cause {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Error for Cause {}

#[derive(Debug)]
struct Fake {
    msg: String,
    cause: Option<Cause>,
}

impl fmt::Display for Fake {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.msg)
    }
}

impl Error for Fake {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.cause.as_ref().map(|c| c as &(dyn Error + 'static))
    }
}

fn fail(msg: &str, cause: Option<&'static str>) -> Fake {
    Fake {
        msg: msg.to_string(),
        cause: cause.map(Cause),
    }
}

#[test]
fn upstream_failed_logs_cause_and_cuts_to_300() {
    let mut lines: Vec<String> = Vec::new();
    let e = fail("fetch failed", Some("getaddrinfo ENOTFOUND x"));
    let r = upstream_failed("pdf", &e, 502, "Upstream fetch failed", &mut |l| {
        lines.push(l.to_string());
    });
    assert_eq!(r, refuse(502, "Upstream fetch failed"));
    assert_eq!(
        lines,
        ["[proxy:pdf] Upstream fetch failed: fetch failed (getaddrinfo ENOTFOUND x)"]
    );

    let long = fail(&"x".repeat(1000), None);
    let mut long_lines: Vec<String> = Vec::new();
    let _ = upstream_failed("pdf", &long, 502, "Upstream fetch failed", &mut |l| {
        long_lines.push(l.to_string());
    });
    let detail = long_lines[0]
        .strip_prefix("[proxy:pdf] Upstream fetch failed: ")
        .unwrap();
    assert_eq!(detail.chars().count(), 300);

    let multi = fail(&"é".repeat(400), None);
    let mut multi_lines: Vec<String> = Vec::new();
    let _ = upstream_failed("pdf", &multi, 502, "Upstream fetch failed", &mut |l| {
        multi_lines.push(l.to_string());
    });
    let detail = multi_lines[0]
        .strip_prefix("[proxy:pdf] Upstream fetch failed: ")
        .unwrap();
    assert_eq!(detail.chars().count(), 300);

    let plain = fail("fetch failed", None);
    let mut plain_lines: Vec<String> = Vec::new();
    let _ = upstream_failed("pdf", &plain, 502, "Upstream fetch failed", &mut |l| {
        plain_lines.push(l.to_string());
    });
    assert_eq!(
        plain_lines,
        ["[proxy:pdf] Upstream fetch failed: fetch failed"]
    );
    assert!(!plain_lines[0].contains(" ("));
}

#[test]
fn public_https_urls() {
    const TRUE_CASES: &[&str] = &[
        "https://example.com/a",
        "https://8.8.8.8/",
        "https://[2606:4700:4700::1111]/",
        "HTTPS://Example.COM/",
    ];
    for case in TRUE_CASES {
        assert!(is_public_https_url(case), "{case}");
    }

    const FALSE_CASES: &[&str] = &[
        "http://example.com",
        "https://user@example.com",
        "https://user:pw@example.com",
        "https://:pw@example.com",
        "https://localhost/",
        "https://app.localhost/",
        "https://127.0.0.1/",
        "https://10.0.0.1/",
        "https://169.254.169.254/latest",
        "https://[::1]/",
        "https://[::ffff:7f00:1]/",
        "ftp://example.com",
        "not a url",
        "",
        "file:///etc/passwd",
    ];
    for case in FALSE_CASES {
        assert!(!is_public_https_url(case), "{case}");
    }
}

fn at() -> Url {
    Url::parse("https://a.example/x/y").unwrap()
}

fn allowed(u: &Url) -> bool {
    u.host_str() != Some("evil.example")
}

fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

#[test]
fn next_hop_rules() {
    let at = at();
    let hop = |h: usize, status: u16, location: Option<&str>| {
        next_hop(h, &at, status, location, &allowed)
    };

    assert_eq!(hop(0, 200, None), Hop::Done);
    assert_eq!(hop(0, 304, None), Hop::Done);
    assert_eq!(hop(0, 302, Some("")), Hop::Done);
    assert_eq!(hop(0, 302, Some("   ")), Hop::Done);

    assert_eq!(
        hop(0, 302, Some("/z")),
        Hop::Follow(url("https://a.example/z"))
    );
    assert_eq!(
        hop(0, 301, Some("../q")),
        Hop::Follow(url("https://a.example/q"))
    );
    assert_eq!(
        hop(0, 307, Some("https://b.example/")),
        Hop::Follow(url("https://b.example/"))
    );
    assert_eq!(
        hop(0, 308, Some("//b.example/p")),
        Hop::Follow(url("https://b.example/p"))
    );

    assert_eq!(
        hop(0, 302, Some("https://evil.example/")),
        Hop::Refuse(refuse(400, "Redirect target not allowed"))
    );

    assert_eq!(
        hop(4, 302, Some("/z")),
        Hop::Follow(url("https://a.example/z"))
    );
    assert_eq!(
        hop(5, 302, Some("/z")),
        Hop::Refuse(refuse(502, "Too many redirects"))
    );
    assert_eq!(
        hop(5, 302, Some("https://evil.example/")),
        Hop::Refuse(refuse(502, "Too many redirects"))
    );
    assert_eq!(MAX_REDIRECTS, 5);

    assert_eq!(
        hop(0, 399, Some("/z")),
        Hop::Follow(url("https://a.example/z"))
    );
    assert_eq!(hop(0, 400, Some("/z")), Hop::Done);
    assert_eq!(hop(0, 299, Some("/z")), Hop::Done);

    assert_eq!(
        hop(0, 302, Some("http://[::1")),
        Hop::Refuse(refuse(502, "Upstream fetch failed"))
    );
}

type Routes = Vec<(&'static str, String)>;

fn redirect(to: &str) -> String {
    format!(
        "HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
}

fn ok(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn not_found() -> String {
    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
}

/// Serves `routes` on 127.0.0.1; returns the base address and the paths hit, in order.
/// `{port}` in a route's raw response is replaced by the server's port.
async fn serve(routes: Routes) -> (Url, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let visited = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&visited);
    drop(tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let routes = routes.clone();
            let seen = Arc::clone(&seen);
            drop(tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 1024];
                while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = sock.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&buf).to_string();
                let path = head
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("")
                    .to_string();
                let x_test = head
                    .lines()
                    .find_map(|l| l.strip_prefix("x-test: "))
                    .map(str::to_string);
                let entry = match x_test {
                    Some(v) => format!("{path} x-test={v}"),
                    None => path.clone(),
                };
                seen.lock().unwrap().push(entry);
                let resp = routes
                    .iter()
                    .find(|(p, _)| *p == path)
                    .map_or_else(not_found, |(_, r)| r.replace("{port}", &port.to_string()));
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            }));
        }
    }));
    (url(&format!("http://127.0.0.1:{port}/")), visited)
}

fn local(u: &Url) -> bool {
    u.host_str() == Some("127.0.0.1")
}

#[tokio::test(flavor = "multi_thread")]
async fn follows_allowed_redirects_to_the_end() {
    let (base, visited) = serve(vec![
        ("/a", redirect("/b")),
        ("/b", redirect("/c")),
        ("/c", ok("ok")),
    ])
    .await;
    let target = base.join("/a").unwrap();
    let checked = fetch_checked_hops(
        &relay_client().unwrap(),
        &target,
        &local,
        &HeaderMap::new(),
        "pdf",
    )
    .await
    .unwrap();
    assert_eq!(checked.url.path(), "/c");
    assert_eq!(checked.response.text().await.unwrap(), "ok");
    assert_eq!(*visited.lock().unwrap(), ["/a", "/b", "/c"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn stops_after_five_redirects() {
    let (base, visited) = serve(vec![
        ("/r0", redirect("/r1")),
        ("/r1", redirect("/r2")),
        ("/r2", redirect("/r3")),
        ("/r3", redirect("/r4")),
        ("/r4", redirect("/r5")),
        ("/r5", redirect("/r6")),
        ("/r6", redirect("/r7")),
    ])
    .await;
    let target = base.join("/r0").unwrap();
    let err = fetch_checked_hops(
        &relay_client().unwrap(),
        &target,
        &local,
        &HeaderMap::new(),
        "pdf",
    )
    .await
    .err();
    assert_eq!(err, Some(refuse(502, "Too many redirects")));
    assert_eq!(
        *visited.lock().unwrap(),
        ["/r0", "/r1", "/r2", "/r3", "/r4", "/r5"]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_disallowed_redirect_before_fetching_it() {
    let (base, visited) = serve(vec![
        ("/a", redirect("http://localhost:{port}/secret")),
        ("/secret", ok("secret")),
    ])
    .await;
    let target = base.join("/a").unwrap();
    let err = fetch_checked_hops(
        &relay_client().unwrap(),
        &target,
        &local,
        &HeaderMap::new(),
        "pdf",
    )
    .await
    .err();
    assert_eq!(err, Some(refuse(400, "Redirect target not allowed")));
    assert_eq!(*visited.lock().unwrap(), ["/a"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn sends_the_given_headers_on_every_hop() {
    let (base, visited) = serve(vec![("/a", redirect("/b")), ("/b", ok("ok"))]).await;
    let target = base.join("/a").unwrap();
    let mut headers = HeaderMap::new();
    let _ = headers.insert("x-test", HeaderValue::from_static("1"));
    let checked = fetch_checked_hops(&relay_client().unwrap(), &target, &local, &headers, "pdf")
        .await
        .unwrap();
    assert_eq!(checked.url.path(), "/b");
    assert_eq!(*visited.lock().unwrap(), ["/a x-test=1", "/b x-test=1"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_upstream_is_502() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let target = url(&format!("http://127.0.0.1:{port}/"));
    let err = fetch_checked_hops(
        &relay_client().unwrap(),
        &target,
        &local,
        &HeaderMap::new(),
        "pdf",
    )
    .await
    .err();
    assert_eq!(err, Some(refuse(502, "Upstream fetch failed")));
}

#[tokio::test(flavor = "multi_thread")]
async fn client_does_not_follow_by_itself() {
    let (base, _visited) = serve(vec![("/a", redirect("/b")), ("/b", ok("ok"))]).await;
    let target = base.join("/a").unwrap();
    let resp = relay_client().unwrap().get(target).send().await.unwrap();
    assert_eq!(resp.status().as_u16(), 302);
}

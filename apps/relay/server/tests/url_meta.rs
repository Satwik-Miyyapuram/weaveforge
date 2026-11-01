//! Tests for the url-meta port (ported from apps/web/src/app/api/url-meta/_meta.ts).

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::collections::HashMap;

use reqwest::{Client, Url};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use wf_relay::fetch::safe::Network;
use wf_relay::fetch::url_shape::UrlRejection;
use wf_relay_server::url_meta::{MetaUpstreams, url_meta};

/// A canned answer from the fake upstream.
struct Reply {
    status: u16,
    content_type: &'static str,
    body: String,
}

fn reply(status: u16, content_type: &'static str, body: &str) -> Reply {
    Reply {
        status,
        content_type,
        body: body.to_owned(),
    }
}

/// Serves `handler(path)` on 127.0.0.1 and returns the base URL.
async fn serve(handler: fn(&str) -> Reply) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("local addr").port();
    drop(tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut buffer = vec![0_u8; 8192];
            let read = socket.read(&mut buffer).await.unwrap_or(0);
            let head = String::from_utf8_lossy(&buffer[..read]).into_owned();
            let path = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
            let answer = handler(&path);
            let raw = format!(
                "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                answer.status,
                answer.content_type,
                answer.body.len(),
                answer.body
            );
            let _ = socket.write_all(raw.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
    }));
    format!("http://127.0.0.1:{port}")
}

/// Replaces DNS and the address rule. `site.test` is loopback, `inner.test` is private.
struct TestNet {
    map: HashMap<String, Vec<String>>,
}

impl Network for TestNet {
    async fn resolve(&self, host: &str) -> Result<Vec<String>, String> {
        self.map
            .get(host)
            .cloned()
            .ok_or_else(|| "no such host".to_owned())
    }

    fn is_allowed(&self, address: &str) -> bool {
        address == "127.0.0.1"
    }

    fn shape(&self, url: &Url) -> Result<(), UrlRejection> {
        match url.scheme() {
            "http" | "https" => Ok(()),
            _ => Err(UrlRejection::Scheme),
        }
    }
}

fn test_net() -> TestNet {
    let mut map = HashMap::new();
    let _ = map.insert("site.test".to_owned(), vec!["127.0.0.1".to_owned()]);
    let _ = map.insert("inner.test".to_owned(), vec!["10.0.0.1".to_owned()]);
    TestNet { map }
}

fn upstreams_at(base: &str) -> MetaUpstreams {
    MetaUpstreams {
        arxiv_query: format!("{base}/api/query"),
        crossref_works: format!("{base}/works"),
    }
}

/// Upstreams that must not be reached: the tests using them never get past the URL checks.
fn no_upstreams() -> MetaUpstreams {
    upstreams_at("http://127.0.0.1:1")
}

async fn call(upstreams: &MetaUpstreams, url: Option<&str>) -> (u16, Value) {
    url_meta(&Client::new(), &test_net(), upstreams, url).await
}

fn port_of(base: &str) -> &str {
    base.rsplit(':').next().unwrap_or("")
}

const ATOM: &str = r#"<feed><entry><title>  A  Paper
 on  X</title><published>2023-01-02T00:00:00Z</published><summary>An &amp; abstract.</summary><author><name>Ada Lovelace</name></author><author><name>Alan &amp; Co</name></author><arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1/abc</arxiv:doi></entry></feed>"#;

const CROSSREF: &str = r#"{"message":{"title":["Deep   Work"],"author":[{"given":"Cal","family":"Newport"},{"name":"Org"}],"issued":{"date-parts":[[2016,1]]},"container-title":["Journal"],"DOI":"10.1145/123.456","abstract":"<jats:p>Hi <b>there</b></jats:p>","URL":"https://doi.org/x"}}"#;

const PAPER_HTML: &str = r#"<html><head><title>Ignored</title><meta name="citation_title" content="Paper Title"><meta name="citation_author" content="Ada Lovelace"></head><body>x</body></html>"#;

#[tokio::test]
async fn missing_or_empty_url_is_refused() {
    let expected = (400, json!({ "error": "url is required" }));
    assert_eq!(call(&no_upstreams(), None).await, expected);
    assert_eq!(call(&no_upstreams(), Some("")).await, expected);
}

#[tokio::test]
async fn unparseable_url_is_invalid() {
    assert_eq!(
        call(&no_upstreams(), Some("http://[::1")).await,
        (400, json!({ "error": "invalid url" }))
    );
}

#[tokio::test]
async fn non_http_scheme_is_refused() {
    assert_eq!(
        call(&no_upstreams(), Some("ftp://example.com/paper.pdf")).await,
        (400, json!({ "error": "url must be http(s)" }))
    );
}

#[tokio::test]
async fn scheme_less_host_is_taken_as_https() {
    // example.com is not in the test resolver, so the fetch fails at resolution, not parsing.
    let (status, body) = call(&no_upstreams(), Some("example.com/paper")).await;
    assert_eq!(status, 502);
    assert!(
        body["error"]
            .as_str()
            .is_some_and(|text| text.starts_with("That host could not be resolved")),
        "{body}"
    );
}

#[tokio::test]
async fn host_with_a_port_is_taken_as_https() {
    // A digit after the colon is a port, not a scheme, so this is not refused as non-http.
    let (status, body) = call(&no_upstreams(), Some("example.com:443/paper")).await;
    assert_eq!(status, 502);
    assert!(
        body["error"]
            .as_str()
            .is_some_and(|text| text.starts_with("That host could not be resolved")),
        "{body}"
    );
}

#[tokio::test]
async fn arxiv_entry_becomes_meta() {
    let base = serve(|path| {
        if path.contains("id_list=2301.00001") {
            reply(200, "application/atom+xml", ATOM)
        } else {
            reply(404, "text/plain", "")
        }
    })
    .await;
    let target = "https://arxiv.org/abs/2301.00001";
    let (status, body) = call(&upstreams_at(&base), Some(target)).await;
    assert_eq!(status, 200);
    assert_eq!(
        body,
        json!({
            "title": "A Paper on X",
            "authors": ["Ada Lovelace", "Alan & Co"],
            "year": 2023,
            "doi": "10.1/abc",
            "arxivId": "2301.00001",
            "abstract": "An & abstract.",
            "url": target,
            "hasCitationMeta": true
        })
    );
}

#[tokio::test]
async fn failed_arxiv_falls_through_to_the_page() {
    let base = serve(|path| {
        if path.starts_with("/api/query") {
            reply(500, "text/plain", "")
        } else {
            reply(200, "text/html", PAPER_HTML)
        }
    })
    .await;
    let target = format!("http://site.test:{}/paper", port_of(&base));
    let (status, body) = call(&upstreams_at(&base), Some(&target)).await;
    assert_eq!(status, 200);
    assert_eq!(body["title"], "Paper Title");
    assert_eq!(body["hasCitationMeta"], true);
    assert_eq!(body["url"], target.as_str());
}

#[tokio::test]
async fn crossref_record_becomes_meta() {
    let base = serve(|path| {
        if path.starts_with("/works/10.1145%2F123.456") {
            reply(200, "application/json", CROSSREF)
        } else {
            reply(404, "text/plain", "")
        }
    })
    .await;
    let (status, body) = call(
        &upstreams_at(&base),
        Some("https://dl.acm.org/doi/10.1145/123.456"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(
        body,
        json!({
            "title": "Deep Work",
            "authors": ["Cal Newport", "Org"],
            "year": 2016,
            "venue": "Journal",
            "doi": "10.1145/123.456",
            "abstract": "Hi there",
            "url": "https://doi.org/x"
        })
    );
}

#[tokio::test]
async fn sparse_crossref_record_falls_back_to_the_doi() {
    let base = serve(|path| {
        if path.starts_with("/works/10.9999%2Fabc") {
            reply(200, "application/json", r#"{"message":{}}"#)
        } else {
            reply(404, "text/plain", "")
        }
    })
    .await;
    let target = "https://doi.org/10.9999/abc";
    let (status, body) = call(&upstreams_at(&base), Some(target)).await;
    assert_eq!(status, 200);
    assert_eq!(
        body,
        json!({
            "title": "10.9999/abc",
            "authors": [],
            "doi": "10.9999/abc",
            "url": target
        })
    );
}

#[tokio::test]
async fn crossref_miss_is_a_404_naming_the_doi() {
    let base = serve(|_| reply(404, "text/plain", "")).await;
    let (status, body) = call(&upstreams_at(&base), Some("https://doi.org/10.1234/xyz")).await;
    assert_eq!(status, 404);
    assert_eq!(
        body,
        json!({
            "error": "DOI 10.1234/xyz not found in Crossref (some ACM DOIs are unregistered). Enter the paper manually or try the arXiv id."
        })
    );
}

#[tokio::test]
async fn unreadable_crossref_body_is_a_miss() {
    let base = serve(|_| reply(200, "application/json", "<html>maintenance</html>")).await;
    let (status, _) = call(&upstreams_at(&base), Some("https://doi.org/10.1234/xyz")).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn null_crossref_body_is_a_miss() {
    let base = serve(|_| reply(200, "application/json", "null")).await;
    let (status, _) = call(&upstreams_at(&base), Some("https://doi.org/10.1234/xyz")).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn page_with_citation_tags_becomes_meta() {
    let base = serve(|_| reply(200, "text/html", PAPER_HTML)).await;
    let target = format!("http://site.test:{}/paper", port_of(&base));
    let (status, body) = call(&upstreams_at(&base), Some(&target)).await;
    assert_eq!(status, 200);
    assert_eq!(body["title"], "Paper Title");
    assert_eq!(body["hasCitationMeta"], true);
    assert_eq!(body["url"], target.as_str());
}

#[tokio::test]
async fn page_without_paper_markers_is_refused_422() {
    let base = serve(|_| {
        reply(
            200,
            "text/html",
            "<html><head><title>Client Challenge</title></head></html>",
        )
    })
    .await;
    let target = format!("http://site.test:{}/paper", port_of(&base));
    let (status, body) = call(&upstreams_at(&base), Some(&target)).await;
    assert_eq!(status, 422);
    assert!(body["error"].is_string(), "{body}");
}

#[tokio::test]
async fn blocked_page_gets_the_doi_hint() {
    let base = serve(|_| reply(403, "text/html", "")).await;
    let target = format!("http://site.test:{}/paper", port_of(&base));
    let (status, body) = call(&upstreams_at(&base), Some(&target)).await;
    assert_eq!(status, 403);
    assert_eq!(
        body,
        json!({
            "error": "Could not read that page: the site blocked automated access. Try the DOI or arXiv id instead."
        })
    );
}

#[tokio::test]
async fn missing_page_is_reported_without_the_hint() {
    let base = serve(|_| reply(404, "text/html", "")).await;
    let target = format!("http://site.test:{}/paper", port_of(&base));
    let (status, body) = call(&upstreams_at(&base), Some(&target)).await;
    assert_eq!(status, 404);
    assert_eq!(
        body,
        json!({ "error": "Could not read that page: the page was not found." })
    );
}

#[tokio::test]
async fn private_address_is_refused_before_any_dial() {
    let base = serve(|_| reply(200, "text/html", PAPER_HTML)).await;
    let target = format!("http://inner.test:{}/paper", port_of(&base));
    assert_eq!(
        call(&upstreams_at(&base), Some(&target)).await,
        (
            400,
            json!({ "error": "That address is on a private network, so it is not fetched." })
        )
    );
}

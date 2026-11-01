//! Relay: the arXiv Atom feed, served on the `app` scheme. Ported from apps/desktop/src/arxiv-proxy.ts.

use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, USER_AGENT};

use super::shared::{Answer, Refusal, RelayRequest, refuse, upstream_failed};

/// Path the page calls.
pub const ARXIV_PROXY_PATH: &str = "/api/arxiv";
/// The arXiv query endpoint.
pub const ARXIV_UPSTREAM: &str = "https://export.arxiv.org/api/query";
/// Longest `id_list`, in UTF-16 units: each id is a result read into memory.
pub const MAX_ID_LIST_CHARS: usize = 4_000;
/// Time allowed for the upstream fetch.
pub const ARXIV_TIMEOUT: Duration = Duration::from_secs(10);

const USER_AGENT_VALUE: &str = "weaveforge (mailto:noreply@example.com)";
const DEFAULT_CONTENT_TYPE: &str = "application/atom+xml; charset=utf-8";

/// Whether the request is for the arXiv path.
#[must_use]
pub fn is_arxiv_proxy_request(url: &reqwest::Url) -> bool {
    url.path() == ARXIV_PROXY_PATH
}

/// JS `encodeURIComponent`: unreserved ASCII stays, every other byte becomes `%XX`.
#[must_use]
pub fn encode_uri_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Answers one arXiv request.
pub async fn proxy_arxiv(
    client: &reqwest::Client,
    request: &RelayRequest,
    upstream: &str,
    timeout: Duration,
) -> Answer {
    if !request.method.eq_ignore_ascii_case("GET") {
        return Answer::from(refuse(405, "Method not allowed"));
    }
    let id_list = match request.url.query_pairs().find(|(k, _)| k == "id_list") {
        Some((_, v)) if !v.is_empty() => v.into_owned(),
        _ => return Answer::from(refuse(400, "id_list is required")),
    };
    if id_list.encode_utf16().count() > MAX_ID_LIST_CHARS {
        let error = format!("id_list must be at most {MAX_ID_LIST_CHARS} characters.");
        return Answer::from(refuse(400, &error));
    }
    match fetch_atom(client, &id_list, upstream, timeout).await {
        Ok(answer) => answer,
        Err(refusal) => Answer::from(refusal),
    }
}

/// Fetches the feed for `id_list`. Any non-2xx or redirect is a refusal.
async fn fetch_atom(
    client: &reqwest::Client,
    id_list: &str,
    upstream: &str,
    timeout: Duration,
) -> Result<Answer, Refusal> {
    let target = format!("{upstream}?id_list={}", encode_uri_component(id_list));
    let response = client
        .get(target)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| fetch_failed(&e))?;
    let status = response.status();
    if status.is_redirection() {
        eprintln!(
            "[proxy:arxiv] Upstream fetch failed: redirect {}",
            status.as_u16()
        );
        return Err(refuse(502, "Upstream fetch failed"));
    }
    if !status.is_success() {
        return Err(refuse(502, &format!("arXiv responded {}", status.as_u16())));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_CONTENT_TYPE)
        .to_string();
    let body = response.bytes().await.map_err(|e| fetch_failed(&e))?;
    Ok(Answer {
        status: 200,
        headers: vec![
            ("content-type".to_string(), content_type),
            ("x-content-type-options".to_string(), "nosniff".to_string()),
        ],
        body: body.to_vec(),
    })
}

/// The refusal for an upstream fetch that failed or broke off.
fn fetch_failed(error: &reqwest::Error) -> Refusal {
    upstream_failed("arxiv", error, 502, "Upstream fetch failed", &mut |l| {
        eprintln!("{l}");
    })
}

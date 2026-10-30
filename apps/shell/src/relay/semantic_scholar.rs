//! Semantic Scholar API relay, with 429 retries. Ported from apps/desktop/src/semantic-scholar-proxy.ts.

use std::time::Duration;

use reqwest::Url;
use reqwest::header::{CONTENT_TYPE, HeaderMap};

use super::shared::{Answer, Refusal, RelayRequest, refuse, upstream_failed};

/// The path prefix the relay answers.
pub const SEMANTIC_SCHOLAR_PROXY_PREFIX: &str = "/api/semantic-scholar/";
/// The upstream base address.
pub const SEMANTIC_SCHOLAR_UPSTREAM: &str = "https://api.semanticscholar.org";
/// Most retries after a 429.
pub const RETRIES: u32 = 3;
/// Whole-request timeout for one upstream send.
pub const SEMANTIC_SCHOLAR_TIMEOUT: Duration = Duration::from_secs(30);
/// The wait before retry n (0-based) is retry_unit * (n + 1); the real unit is 1 s.
pub const RETRY_UNIT: Duration = Duration::from_secs(1);

/// Whether the request path is under the relay prefix.
#[must_use]
pub fn is_semantic_scholar_proxy_request(url: &Url) -> bool {
    url.path().starts_with(SEMANTIC_SCHOLAR_PROXY_PREFIX)
}

/// The upstream address for a relayed path, or `None` when it is not allowed.
#[must_use]
pub fn semantic_scholar_target(pathname: &str, search: &str, upstream: &str) -> Option<String> {
    let rest = pathname.strip_prefix(SEMANTIC_SCHOLAR_PROXY_PREFIX)?;
    if rest.is_empty() || rest.contains("..") || rest.starts_with('/') || has_scheme(rest) {
        return None;
    }
    Some(format!("{upstream}/{rest}{search}"))
}

/// True when `rest` starts with 1+ ASCII letters followed by `://`.
fn has_scheme(rest: &str) -> bool {
    let letters = rest.bytes().take_while(u8::is_ascii_alphabetic).count();
    letters > 0 && rest.get(letters..).is_some_and(|r| r.starts_with("://"))
}

/// The headers sent upstream: accept, then the forwarded ones present.
#[must_use]
pub fn forwarded_headers(incoming: &HeaderMap) -> Vec<(String, String)> {
    let mut out = vec![("accept".to_string(), "application/json".to_string())];
    for name in ["x-api-key", "content-type"] {
        let value = incoming
            .get(name)
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty());
        if let Some(value) = value {
            out.push((name.to_string(), value.to_string()));
        }
    }
    out
}

/// Relays one request to Semantic Scholar, retrying 429s.
pub async fn proxy_semantic_scholar(
    client: &reqwest::Client,
    request: &RelayRequest,
    upstream: &str,
    timeout: Duration,
    retry_unit: Duration,
) -> Answer {
    match relay(client, request, upstream, timeout, retry_unit).await {
        Ok(answer) => answer,
        Err(refusal) => Answer::from(refusal),
    }
}

async fn relay(
    client: &reqwest::Client,
    request: &RelayRequest,
    upstream: &str,
    timeout: Duration,
    retry_unit: Duration,
) -> Result<Answer, Refusal> {
    let method = match request.method.to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return Err(refuse(405, "Method not allowed")),
    };
    let search = match request.url.query() {
        Some(query) if !query.is_empty() => format!("?{query}"),
        _ => String::new(),
    };
    let target = semantic_scholar_target(request.url.path(), &search, upstream)
        .ok_or_else(|| refuse(400, "Bad Semantic Scholar path"))?;
    let headers = forwarded_headers(&request.headers);
    let body = (method == reqwest::Method::POST)
        .then(|| String::from_utf8_lossy(&request.body).into_owned());

    let send = || send_once(client, &method, &target, &headers, body.as_deref(), timeout);
    let mut response = send().await.map_err(|e| fail(&e))?;
    for attempt in 0..RETRIES {
        if response.status().as_u16() != 429 {
            break;
        }
        tokio::time::sleep(retry_unit.saturating_mul(attempt + 1)).await;
        response = send().await.map_err(|e| fail(&e))?;
    }

    let status = response.status().as_u16();
    if (300..400).contains(&status) {
        eprintln!("[proxy:semantic-scholar] Upstream fetch failed: redirect {status}");
        return Err(refuse(502, "Upstream fetch failed"));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let body = response.bytes().await.map_err(|e| fail(&e))?;
    Ok(Answer {
        status,
        headers: vec![
            ("content-type".to_string(), content_type),
            ("x-content-type-options".to_string(), "nosniff".to_string()),
        ],
        body: body.to_vec(),
    })
}

async fn send_once(
    client: &reqwest::Client,
    method: &reqwest::Method,
    target: &str,
    headers: &[(String, String)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut builder = client.request(method.clone(), target).timeout(timeout);
    for (name, value) in headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = body {
        builder = builder.body(body.to_owned());
    }
    builder.send().await
}

/// The 502 refusal for a failed upstream fetch, logged.
fn fail(error: &reqwest::Error) -> Refusal {
    upstream_failed(
        "semantic-scholar",
        error,
        502,
        "Upstream fetch failed",
        &mut |l| {
            eprintln!("{l}");
        },
    )
}

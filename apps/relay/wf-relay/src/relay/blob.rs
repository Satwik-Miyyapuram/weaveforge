//! Blob store relay. Ported from apps/desktop/src/blob-proxy.ts.

use std::error::Error;
use std::time::Duration;

use reqwest::Url;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap};

use super::shared::{Answer, RelayRequest, refuse, upstream_failed};

/// Path prefix of the blob routes.
pub const BLOB_PROXY_PREFIX: &str = "/api/blobs/";
/// The hosted app the blob routes live on.
pub const BLOB_UPSTREAM: &str = "https://app.weaveforge.org";
/// How long one blob request may take.
pub const BLOB_TIMEOUT: Duration = Duration::from_secs(120);

/// Whether the request path is under the blob prefix.
#[must_use]
pub fn is_blob_proxy_request(url: &Url) -> bool {
    url.path().starts_with(BLOB_PROXY_PREFIX)
}

/// Relays one blob request to the hosted app. Only GET and POST go; the path may not
/// be empty or hold `..` or `//`.
pub async fn proxy_blob(
    client: &reqwest::Client,
    request: &RelayRequest,
    upstream: &str,
    timeout: Duration,
) -> Answer {
    let method = request.method.to_ascii_uppercase();
    if method != "GET" && method != "POST" {
        return Answer::from(refuse(405, "Method not allowed"));
    }
    let rest = request
        .url
        .path()
        .strip_prefix(BLOB_PROXY_PREFIX)
        .unwrap_or("");
    if rest.is_empty() || rest.contains("..") || rest.contains("//") {
        return Answer::from(refuse(400, "Bad blob path"));
    }
    let search = match request.url.query() {
        Some(query) if !query.is_empty() => format!("?{query}"),
        _ => String::new(),
    };
    let path_and_query = format!("{BLOB_PROXY_PREFIX}{rest}{search}");
    relay_to_hosted_app(client, request, &path_and_query, upstream, timeout, "blob").await
}

/// Sends one `app://` request on to the same path on the hosted app. Only `authorization` and `content-type`
/// travel, the body goes as bytes (POST only), and a dead network answers 502. The caller decides which paths and methods may go.
pub async fn relay_to_hosted_app(
    client: &reqwest::Client,
    request: &RelayRequest,
    path_and_query: &str,
    upstream: &str,
    timeout: Duration,
    proxy: &str,
) -> Answer {
    let Ok(method) = reqwest::Method::from_bytes(request.method.to_ascii_uppercase().as_bytes())
    else {
        return Answer::from(refuse(405, "Method not allowed"));
    };
    let mut headers = HeaderMap::new();
    for name in [AUTHORIZATION, CONTENT_TYPE] {
        if let Some(value) = request.headers.get(&name)
            && !value.as_bytes().is_empty()
        {
            let _ = headers.insert(name, value.clone());
        }
    }
    let mut builder = client
        .request(method.clone(), format!("{upstream}{path_and_query}"))
        .headers(headers)
        .timeout(timeout);
    if method == reqwest::Method::POST {
        builder = builder.body(request.body.clone());
    }
    let response = match builder.send().await {
        Ok(response) => response,
        Err(e) => return upstream_refusal(proxy, &e),
    };
    let status = response.status().as_u16();
    if response.status().is_redirection() {
        eprintln!("[proxy:{proxy}] Upstream fetch failed: redirect {status}");
        return Answer::from(refuse(502, "Upstream fetch failed"));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let body = match response.bytes().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => return upstream_refusal(proxy, &e),
    };
    Answer {
        status,
        headers: vec![
            ("content-type".to_string(), content_type),
            ("x-content-type-options".to_string(), "nosniff".to_string()),
        ],
        body,
    }
}

/// The 502 answer for an upstream that could not be reached or broke off, with the log line.
fn upstream_refusal(proxy: &str, error: &dyn Error) -> Answer {
    Answer::from(upstream_failed(
        proxy,
        error,
        502,
        "Upstream fetch failed",
        &mut |line| eprintln!("{line}"),
    ))
}

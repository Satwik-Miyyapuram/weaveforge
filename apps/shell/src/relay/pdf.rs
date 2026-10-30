//! The reader's PDF proxy: papers from allowlisted hosts, checked for PDF magic. Ported from apps/desktop/src/pdf-proxy.ts.

use std::error::Error;
use std::time::Duration;

use reqwest::Url;
use reqwest::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE, HeaderMap, HeaderValue, USER_AGENT};

use super::shared::{
    Answer, Refusal, fetch_checked_hops, is_public_https_url, read_capped, refuse, upstream_failed,
};

/// The path the page requests: `app://localhost/api/pdf-proxy`.
pub const PDF_PROXY_PATH: &str = "/api/pdf-proxy";

/// Hard cap on a proxied PDF, in bytes (80 MiB).
pub const PDF_PROXY_MAX_BYTES: usize = 80 * 1024 * 1024;

/// How far into the body `%PDF` may sit.
pub const PDF_MAGIC_WINDOW: usize = 1024;

/// The whole fetch and read must finish within this.
pub const PDF_TIMEOUT: Duration = Duration::from_secs(90);

/// Hosts the reader may fetch PDFs from without `typed=1`.
pub const PDF_PROXY_ALLOWED_HOSTS: &[&str] = &[
    // Preprints and repositories.
    "arxiv.org",
    "www.arxiv.org",
    "export.arxiv.org",
    "openreview.net",
    "www.openreview.net",
    "biorxiv.org",
    "www.biorxiv.org",
    "medrxiv.org",
    "www.medrxiv.org",
    "chemrxiv.org",
    "www.chemrxiv.org",
    "ncbi.nlm.nih.gov",
    "www.ncbi.nlm.nih.gov",
    "pmc.ncbi.nlm.nih.gov",
    "europepmc.org",
    "www.europepmc.org",
    "hal.science",
    "hal.archives-ouvertes.fr",
    "zenodo.org",
    // Open-access publishers.
    "journals.plos.org",
    "plos.org",
    "www.plos.org",
    "elifesciences.org",
    "www.elifesciences.org",
    "frontiersin.org",
    "www.frontiersin.org",
    "mdpi.com",
    "www.mdpi.com",
    "copernicus.org",
    "www.copernicus.org",
    "olh.openlibhums.org",
    "openlibhums.org",
    "springeropen.com",
    "www.springeropen.com",
    "link.springer.com",
];

/// True when the request is for the PDF proxy path.
#[must_use]
pub fn is_pdf_proxy_request(url: &Url) -> bool {
    url.path() == PDF_PROXY_PATH
}

/// True for an https address with no credentials on an allowlisted host.
#[must_use]
pub fn is_allowed_pdf_proxy_url(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match url.host_str() {
        Some(host) => {
            let host = host.to_ascii_lowercase();
            PDF_PROXY_ALLOWED_HOSTS.contains(&host.as_str())
        }
        None => false,
    }
}

/// True for a PDF or octet-stream content type.
#[must_use]
pub fn is_pdf_content_type(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let kind = value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    kind == "application/pdf" || kind == "application/octet-stream"
}

/// True when `%PDF` sits within the first `PDF_MAGIC_WINDOW` bytes.
#[must_use]
pub fn has_pdf_magic(bytes: &[u8]) -> bool {
    let window = bytes.get(..PDF_MAGIC_WINDOW).unwrap_or(bytes);
    window.windows(4).any(|w| w == b"%PDF")
}

/// Answers a page's PDF request (`?url=`, optional `typed=1`).
pub async fn proxy_pdf(client: &reqwest::Client, request_url: &Url) -> Answer {
    let Some(target) = query_value(request_url, "url").filter(|t| !t.is_empty()) else {
        return Answer::from(refuse(400, "url is required"));
    };
    let typed = query_value(request_url, "typed").as_deref() == Some("1");
    let not_allowed = Answer::from(refuse(400, "URL host is not allowed for PDF proxy"));
    if !allowed_for(typed, &target) {
        return not_allowed;
    }
    let Ok(target_url) = Url::parse(&target) else {
        return not_allowed;
    };
    let allowed = move |url: &Url| allowed_for(typed, url.as_str());
    relay_pdf(
        client,
        &target_url,
        &allowed,
        PDF_PROXY_MAX_BYTES,
        PDF_TIMEOUT,
    )
    .await
}

/// The first value of query parameter `name`.
fn query_value(url: &Url, name: &str) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

/// Typed addresses may be any public https host; others must be on the allowlist.
fn allowed_for(typed: bool, raw: &str) -> bool {
    if typed {
        is_public_https_url(raw)
    } else {
        is_allowed_pdf_proxy_url(raw)
    }
}

/// Fetches `target` under `allowed`, checks it is a PDF, and answers with its bytes.
pub async fn relay_pdf(
    client: &reqwest::Client,
    target: &Url,
    allowed: &dyn Fn(&Url) -> bool,
    max: usize,
    timeout: Duration,
) -> Answer {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut headers = HeaderMap::new();
    let _ = headers.insert(ACCEPT, HeaderValue::from_static("application/pdf"));
    let _ = headers.insert(USER_AGENT, HeaderValue::from_static("WeaveForge desktop"));

    let fetched = tokio::time::timeout_at(
        deadline,
        fetch_checked_hops(client, target, allowed, &headers, "pdf"),
    )
    .await;
    let response = match fetched {
        Err(elapsed) => return failure(&elapsed, 502, "Upstream fetch failed"),
        Ok(Err(refusal)) => return Answer::from(refusal),
        Ok(Ok(checked)) => checked.response,
    };
    match check_headers(&response, max) {
        Ok(()) => read_pdf(response, deadline, max).await,
        Err(refusal) => Answer::from(refusal),
    }
}

/// Upstream's status, content type and declared size, in the TS order.
fn check_headers(response: &reqwest::Response, max: usize) -> Result<(), Refusal> {
    let status = response.status();
    if !status.is_success() {
        return Err(refuse(
            502,
            &format!("Upstream returned {}", status.as_u16()),
        ));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());
    if !is_pdf_content_type(content_type) {
        return Err(refuse(415, "Upstream did not return a PDF"));
    }
    let declared = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let too_big = match usize::try_from(declared) {
        Ok(size) => size > max,
        Err(_) => true,
    };
    if too_big {
        return Err(refuse(413, "PDF too large"));
    }
    Ok(())
}

/// Reads the capped body under the deadline, then checks its magic.
async fn read_pdf(
    response: reqwest::Response,
    deadline: tokio::time::Instant,
    max: usize,
) -> Answer {
    let bytes = match tokio::time::timeout_at(deadline, read_capped(response, max)).await {
        Err(elapsed) => return body_failure(&elapsed),
        Ok(Err(e)) => return body_failure(&e),
        Ok(Ok(None)) => return Answer::from(refuse(413, "PDF too large")),
        Ok(Ok(Some(bytes))) => bytes,
    };
    if !has_pdf_magic(&bytes) {
        return Answer::from(refuse(415, "Upstream did not return a PDF"));
    }
    Answer {
        status: 200,
        headers: vec![
            ("content-type".to_string(), "application/pdf".to_string()),
            ("content-length".to_string(), bytes.len().to_string()),
            ("x-content-type-options".to_string(), "nosniff".to_string()),
            (
                "content-security-policy".to_string(),
                "default-src 'none'; sandbox".to_string(),
            ),
        ],
        body: bytes,
    }
}

/// The answer for a body that stalled or broke off.
fn body_failure(error: &dyn Error) -> Answer {
    failure(error, 504, "Upstream body did not arrive in time")
}

/// Logs the failure as `upstream_failed` does, then answers with the refusal.
fn failure(error: &dyn Error, status: u16, refusal: &str) -> Answer {
    Answer::from(upstream_failed("pdf", error, status, refusal, &mut |l| {
        eprintln!("{l}");
    }))
}

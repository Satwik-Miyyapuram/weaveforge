//! The reader's HTML page relay. Ported from apps/desktop/src/html-proxy.ts.

use std::time::Duration;

use reqwest::Url;
use reqwest::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE, HeaderMap, HeaderValue, USER_AGENT};
use tokio::time::{Instant, timeout_at};

use super::shared::{
    Answer, Refusal, fetch_checked_hops, is_public_https_url, read_capped, refuse, upstream_failed,
};

/// Path the page requests.
pub const HTML_PROXY_PATH: &str = "/api/html-proxy";
/// Largest page the relay returns.
pub const HTML_PROXY_MAX_BYTES: usize = 15 * 1024 * 1024;
/// Header carrying the address the page ended at.
pub const HTML_FINAL_URL_HEADER: &str = "x-final-url";
/// Deadline for the whole fetch.
pub const HTML_TIMEOUT: Duration = Duration::from_secs(60);

/// Name the failures are logged under.
const PROXY: &str = "html";
/// How many leading bytes are searched for a `<meta charset>`.
const HEAD_BYTES: usize = 4096;

/// Whether `url` is the HTML relay's path.
#[must_use]
pub fn is_html_proxy_request(url: &Url) -> bool {
    url.path() == HTML_PROXY_PATH
}

/// Whether the content type is a web page.
#[must_use]
pub fn is_html_content_type(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let essence = value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    essence == "text/html" || essence == "application/xhtml+xml"
}

/// The page's charset label, lowercased: the header's, else a `<meta>`'s, else UTF-8.
#[must_use]
pub fn charset_of(content_type: Option<&str>, head: &str) -> String {
    content_type
        .and_then(charset_in_header)
        .or_else(|| charset_in_meta(head))
        .map_or_else(|| "utf-8".to_string(), |c| c.to_ascii_lowercase())
}

/// Decode a page's bytes with the charset it declares. An unknown label reads as UTF-8.
#[must_use]
pub fn decode_html_bytes(bytes: &[u8], content_type: Option<&str>) -> String {
    let head_bytes = bytes.get(..bytes.len().min(HEAD_BYTES)).unwrap_or(bytes);
    let head = encoding_rs::WINDOWS_1252.decode(head_bytes).0;
    let charset = charset_of(content_type, &head);
    let encoding =
        encoding_rs::Encoding::for_label(charset.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    encoding.decode_with_bom_removal(bytes).0.into_owned()
}

/// Answer the reader's HTML request: `?url=` must be an https address.
pub async fn proxy_html(client: &reqwest::Client, request_url: &Url) -> Answer {
    let raw = request_url
        .query_pairs()
        .find(|(k, _)| *k == "url")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    if raw.is_empty() {
        return Answer::from(refuse(400, "url is required"));
    }
    let not_https = refuse(400, "Only https addresses can be fetched");
    if !is_public_https_url(&raw) {
        return Answer::from(not_https);
    }
    let Ok(target) = Url::parse(&raw) else {
        return Answer::from(not_https);
    };
    relay_html(
        client,
        &target,
        &|u: &Url| is_public_https_url(u.as_str()),
        HTML_PROXY_MAX_BYTES,
        HTML_TIMEOUT,
    )
    .await
}

/// Fetch `target` and relay it as text, with the address it ended at.
pub async fn relay_html(
    client: &reqwest::Client,
    target: &Url,
    allowed: &dyn Fn(&Url) -> bool,
    max: usize,
    timeout: Duration,
) -> Answer {
    let deadline = Instant::now() + timeout;
    let checked = match timeout_at(
        deadline,
        fetch_checked_hops(client, target, allowed, &page_headers(), PROXY),
    )
    .await
    {
        Ok(Ok(checked)) => checked,
        Ok(Err(refusal)) => return Answer::from(refusal),
        Err(elapsed) => {
            return Answer::from(upstream_failed(
                PROXY,
                &elapsed,
                502,
                "Upstream fetch failed",
                &mut |l| eprintln!("{l}"),
            ));
        }
    };
    if let Some(refusal) = page_refusal(&checked.response, max) {
        return Answer::from(refusal);
    }
    let content_type = checked
        .response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let final_url = checked.url.as_str().to_string();
    match timeout_at(deadline, read_capped(checked.response, max)).await {
        Ok(Ok(Some(bytes))) => page_answer(&bytes, content_type.as_deref(), &final_url),
        Ok(Ok(None)) => Answer::from(refuse(413, "Page too large")),
        Ok(Err(e)) => body_failed(&e),
        Err(elapsed) => body_failed(&elapsed),
    }
}

/// The headers the page is requested with.
fn page_headers() -> HeaderMap {
    [
        (
            ACCEPT,
            HeaderValue::from_static("text/html,application/xhtml+xml"),
        ),
        (USER_AGENT, HeaderValue::from_static("WeaveForge desktop")),
    ]
    .into_iter()
    .collect()
}

/// The refusal for a final response that is not a page we relay, if any.
fn page_refusal(response: &reqwest::Response, max: usize) -> Option<Refusal> {
    let status = response.status();
    if !status.is_success() {
        return Some(refuse(
            502,
            &format!("Upstream returned {}", status.as_u16()),
        ));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());
    if !is_html_content_type(content_type) {
        return Some(refuse(415, "Upstream did not return a web page"));
    }
    let declared = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    if declared > u64::try_from(max).unwrap_or(u64::MAX) {
        return Some(refuse(413, "Page too large"));
    }
    None
}

/// A body that broke off or did not arrive in time.
fn body_failed(error: &dyn std::error::Error) -> Answer {
    Answer::from(upstream_failed(
        PROXY,
        error,
        504,
        "Upstream body did not arrive in time",
        &mut |l| eprintln!("{l}"),
    ))
}

/// The 200 answer: the decoded markup as text, under a sandboxing CSP.
fn page_answer(bytes: &[u8], content_type: Option<&str>, final_url: &str) -> Answer {
    Answer {
        status: 200,
        headers: vec![
            (
                "content-type".to_string(),
                "text/plain; charset=utf-8".to_string(),
            ),
            ("x-content-type-options".to_string(), "nosniff".to_string()),
            (
                "content-security-policy".to_string(),
                "default-src 'none'; sandbox".to_string(),
            ),
            ("cache-control".to_string(), "private, no-store".to_string()),
            (HTML_FINAL_URL_HEADER.to_string(), final_url.to_string()),
        ],
        body: decode_html_bytes(bytes, content_type).into_bytes(),
    }
}

/// Bytes that may label a charset: ASCII letters, digits, `_ . : -`.
fn is_label_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-')
}

/// The index of the first byte at or after `i` that is not ASCII whitespace.
fn skip_space(s: &[u8], mut i: usize) -> usize {
    while s.get(i).is_some_and(u8::is_ascii_whitespace) {
        i += 1;
    }
    i
}

/// The label that follows `charset` (ending at `i`): `\s*=\s*` then an optional quote from `quotes`, then label bytes.
fn label_at(s: &[u8], i: usize, quotes: &[u8]) -> Option<String> {
    let mut i = skip_space(s, i);
    if s.get(i) != Some(&b'=') {
        return None;
    }
    i = skip_space(s, i + 1);
    if s.get(i).is_some_and(|b| quotes.contains(b)) {
        i += 1;
    }
    let start = i;
    while s.get(i).is_some_and(|&b| is_label_byte(b)) {
        i += 1;
    }
    if i == start {
        return None;
    }
    s.get(start..i)
        .map(|label| String::from_utf8_lossy(label).into_owned())
}

/// Every index at which `needle` starts in `hay`.
fn occurrences(hay: &[u8], needle: &[u8]) -> Vec<usize> {
    (0..hay.len())
        .filter(|&i| hay.get(i..).is_some_and(|t| t.starts_with(needle)))
        .collect()
}

/// The charset named in the `Content-Type` header value.
fn charset_in_header(content_type: &str) -> Option<String> {
    let lower = content_type.to_ascii_lowercase();
    let s = lower.as_bytes();
    occurrences(s, b"charset")
        .into_iter()
        .find_map(|i| label_at(s, i + "charset".len(), b"\""))
}

/// The charset named in the first `<meta` tag of `head` that names one.
fn charset_in_meta(head: &str) -> Option<String> {
    let lower = head.to_ascii_lowercase();
    let s = lower.as_bytes();
    occurrences(s, b"<meta")
        .into_iter()
        .find_map(|i| charset_in_tag(s.get(i + "<meta".len()..).unwrap_or(&[])))
}

/// The charset in one tag, which runs up to the next `>`. The last `charset` wins, as the greedy regex would take it.
fn charset_in_tag(rest: &[u8]) -> Option<String> {
    let end = rest.iter().position(|&b| b == b'>').unwrap_or(rest.len());
    let tag = rest.get(..end).unwrap_or(&[]);
    occurrences(tag, b"charset")
        .into_iter()
        .rev()
        .filter(|&i| i >= 1)
        .find_map(|i| label_at(tag, i + "charset".len(), b"\"'"))
}

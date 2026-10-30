//! Zotero desktop local API relay. Ported from apps/desktop/src/zotero-local.ts.

use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::Url;
use reqwest::header::HeaderMap;

use crate::relay::shared::read_capped;

/// Where Zotero's own local API listens.
pub const LOCAL_ORIGIN: &str = "http://127.0.0.1:23119";
/// The local API root (TS `ZOTERO_LOCAL_API`).
pub const ZOTERO_LOCAL_API: &str = "http://127.0.0.1:23119/api";
/// The library path the local API uses for "my library".
pub const ZOTERO_LOCAL_LIBRARY: &str = "users/0";
/// How long one local request may take.
pub const ZOTERO_LOCAL_TIMEOUT: Duration = Duration::from_secs(20);
/// Largest body relayed (new; TS had none). 64 MiB.
pub const MAX_ZOTERO_BODY: usize = 64 * 1024 * 1024;
/// Refusal for a URL outside the local API.
pub const NOT_LOCAL: &str = "Only the Zotero API on this computer can be read here.";
/// Fallback when Zotero does not answer (TS fallback in `main.ts`).
pub const NOT_ANSWERING: &str = "Zotero on this computer did not answer. Is it running?";
/// Refusal for a body over `MAX_ZOTERO_BODY`.
pub const TOO_LARGE: &str = "Zotero's answer was too large to read.";

/// Response headers the pager reads. Nothing else crosses.
const KEEP_HEADERS: [&str; 4] = ["total-results", "backoff", "retry-after", "content-type"];
/// UTF-8 byte order mark, dropped as `.text()` does.
const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// What came back (TS `{status, body, headers}`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct ZoteroLocalReply {
    /// HTTP status, as sent.
    pub status: u16,
    /// Body as UTF-8 text.
    pub body: String,
    /// The kept response headers, names in lower case.
    pub headers: BTreeMap<String, String>,
}

/// True only for a URL on the local Zotero API under `LOCAL_ORIGIN`.
#[must_use]
pub fn is_local_zotero_url(raw: &str) -> bool {
    is_zotero_url_at(raw, LOCAL_ORIGIN)
}

/// True only for a URL under `origin`'s `/api` path with no credentials.
#[must_use]
pub fn is_zotero_url_at(raw: &str, origin: &str) -> bool {
    let (Ok(url), Ok(origin_url)) = (Url::parse(raw), Url::parse(origin)) else {
        return false;
    };
    let path = url.path();
    url.origin().ascii_serialization() == origin_url.origin().ascii_serialization()
        && url.username().is_empty()
        && url.password().is_none()
        && (path == "/api" || path.starts_with("/api/"))
}

/// Fetches from Zotero's own local API at `LOCAL_ORIGIN`.
pub async fn fetch_zotero_local(raw: &str) -> Result<ZoteroLocalReply, String> {
    fetch_zotero_at(raw, LOCAL_ORIGIN, ZOTERO_LOCAL_TIMEOUT).await
}

/// GETs `raw` if it is on `origin`'s `/api` path. Redirects are not followed; a 3xx is
/// `NOT_ANSWERING`, the fallback sentence that TS's `redirect: "error"` throw maps to.
pub async fn fetch_zotero_at(
    raw: &str,
    origin: &str,
    timeout: Duration,
) -> Result<ZoteroLocalReply, String> {
    if !is_zotero_url_at(raw, origin) {
        return Err(NOT_LOCAL.to_owned());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        // Node fetch ignores proxy settings, and a proxy cannot reach this computer's Zotero.
        .no_proxy()
        .timeout(timeout)
        .build()
        .map_err(|_| NOT_ANSWERING.to_owned())?;
    let response = client
        .get(raw)
        .header("Zotero-API-Version", "3")
        .send()
        .await
        .map_err(|_| NOT_ANSWERING.to_owned())?;
    if response.status().is_redirection() {
        return Err(NOT_ANSWERING.to_owned());
    }
    let headers = kept_headers(response.headers());
    let status = response.status().as_u16();
    let bytes = read_capped(response, MAX_ZOTERO_BODY)
        .await
        .map_err(|_| NOT_ANSWERING.to_owned())?
        .ok_or_else(|| TOO_LARGE.to_owned())?;
    Ok(ZoteroLocalReply {
        status,
        body: decode_body(&bytes),
        headers,
    })
}

/// The pager's headers, lower-cased. Repeated values are joined with ", " and read as
/// Latin-1, as `Headers.get` does; an empty value is skipped.
fn kept_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    let mut kept = BTreeMap::new();
    for name in KEEP_HEADERS {
        let values: Vec<String> = headers
            .get_all(name)
            .iter()
            .map(|v| v.as_bytes().iter().map(|&b| char::from(b)).collect())
            .collect();
        let value = values.join(", ");
        if !value.is_empty() {
            let _ = kept.insert(name.to_owned(), value);
        }
    }
    kept
}

/// The body as text, with one leading BOM dropped the way `.text()` does.
fn decode_body(bytes: &[u8]) -> String {
    let text = bytes.strip_prefix(BOM).unwrap_or(bytes);
    String::from_utf8_lossy(text).into_owned()
}

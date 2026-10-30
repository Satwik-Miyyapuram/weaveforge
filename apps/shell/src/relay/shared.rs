//! What every relay shares: its error answer, its https rule, and redirect checking. Ported from apps/desktop/src/proxy-shared.ts.

use super::address;

/// Most redirects a relay follows before giving up.
pub const MAX_REDIRECTS: usize = 5;

/// A refusal the page sees: an HTTP status and a JSON `{ "error": ... }` body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    /// HTTP status.
    pub status: u16,
    /// Text for the page.
    pub error: String,
}

impl Refusal {
    /// The JSON body: `{"error":"<error>"}`.
    #[must_use]
    pub fn body(&self) -> String {
        serde_json::json!({ "error": self.error }).to_string()
    }
}

/// A refusal with the given status and text.
#[must_use]
pub fn refuse(status: u16, error: &str) -> Refusal {
    Refusal {
        status,
        error: error.to_string(),
    }
}

/// `refuse`, when upstream could not be reached or broke off. `warn` gets the line
/// `[proxy:{proxy}] {refusal}: {detail}`, where detail is `error.to_string()` plus
/// ` ({source})` when `error.source()` is Some, cut to its first 300 chars.
#[must_use]
pub fn upstream_failed(
    proxy: &str,
    error: &dyn std::error::Error,
    status: u16,
    refusal: &str,
    warn: &mut dyn FnMut(&str),
) -> Refusal {
    let mut detail = error.to_string();
    if let Some(source) = error.source() {
        detail = format!("{detail} ({source})");
    }
    let detail: String = detail.chars().take(300).collect();
    warn(&format!("[proxy:{proxy}] {refusal}: {detail}"));
    refuse(status, refusal)
}

/// An https address with no username or password, on a host that is not private.
#[must_use]
pub fn is_public_https_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match url.host_str() {
        Some(host) if !host.is_empty() => !address::is_private_host(host),
        _ => false,
    }
}

/// What to do after one hop's response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Hop {
    /// Fetch this address next.
    Follow(reqwest::Url),
    /// This response is the answer.
    Done,
    /// Stop and answer with this.
    Refuse(Refusal),
}

/// The decision for hop number `hop` (0 for the first fetch) at address `at`.
#[must_use]
pub fn next_hop(
    hop: usize,
    at: &reqwest::Url,
    status: u16,
    location: Option<&str>,
    allowed: &dyn Fn(&reqwest::Url) -> bool,
) -> Hop {
    let location = match location.map(str::trim) {
        Some(l) if (300..400).contains(&status) && !l.is_empty() => l,
        _ => return Hop::Done,
    };
    if hop >= MAX_REDIRECTS {
        return Hop::Refuse(refuse(502, "Too many redirects"));
    }
    let Ok(next) = at.join(location) else {
        return Hop::Refuse(refuse(502, "Upstream fetch failed"));
    };
    if !allowed(&next) {
        return Hop::Refuse(refuse(400, "Redirect target not allowed"));
    }
    Hop::Follow(next)
}

/// A client that never follows redirects itself, so each hop can be checked.
/// # Errors
/// When reqwest cannot build the client (TLS backend failed to load).
pub fn relay_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

/// A checked answer: the response and the address it came from.
#[derive(Debug)]
pub struct Checked {
    /// The final response.
    pub response: reqwest::Response,
    /// The address it came from.
    pub url: reqwest::Url,
}

/// Fetch `target` with GET, following redirects one hop at a time so each address
/// is held to `allowed` before it is fetched. `client` must come from `relay_client`.
/// # Errors
/// A `Refusal`: see the rules below.
pub async fn fetch_checked_hops(
    client: &reqwest::Client,
    target: &reqwest::Url,
    allowed: &dyn Fn(&reqwest::Url) -> bool,
    headers: &reqwest::header::HeaderMap,
    proxy: &str,
) -> Result<Checked, Refusal> {
    // No followOpaque: reqwest has no opaque redirects, so every hop is checked here.
    let mut at = target.clone();
    let mut hop: usize = 0;
    loop {
        let response = match client.get(at.clone()).headers(headers.clone()).send().await {
            Ok(response) => response,
            Err(e) => {
                return Err(upstream_failed(
                    proxy,
                    &e,
                    502,
                    "Upstream fetch failed",
                    &mut |l| {
                        eprintln!("{l}");
                    },
                ));
            }
        };
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok());
        match next_hop(hop, &at, response.status().as_u16(), location, allowed) {
            Hop::Follow(next) => at = next,
            Hop::Refuse(refusal) => return Err(refusal),
            Hop::Done => return check_final(response, allowed),
        }
        hop += 1;
    }
}

/// The last response must sit on an allowed address too.
fn check_final(
    response: reqwest::Response,
    allowed: &dyn Fn(&reqwest::Url) -> bool,
) -> Result<Checked, Refusal> {
    if !allowed(response.url()) {
        return Err(refuse(400, "Redirect target not allowed"));
    }
    let url = response.url().clone();
    Ok(Checked { response, url })
}

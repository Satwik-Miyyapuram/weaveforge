//! Fetches a public URL on the reader's behalf, pinning each hop to an address checked as public.

use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use reqwest::redirect::Policy;
use reqwest::{Client, Response, Url};

use super::is_js_space;
use super::url_shape::{FetchLimits, UrlRejection, check_url_shape, describe_rejection};
use crate::relay::address::is_public_address;

/// What the fetch does that a test replaces: DNS, the address rule and the URL shape rule.
pub trait Network: Send + Sync {
    /// Every address `host` resolves to, as strings ("1.2.3.4", "::1").
    fn resolve(&self, host: &str) -> impl Future<Output = Result<Vec<String>, String>> + Send;
    /// True when `address` may be dialled.
    fn is_allowed(&self, address: &str) -> bool;
    /// The shape check for one hop.
    fn shape(&self, url: &Url) -> Result<(), UrlRejection>;
}

/// The real network: system DNS, public addresses only, `check_url_shape`.
pub struct PublicNetwork;

impl Network for PublicNetwork {
    async fn resolve(&self, host: &str) -> Result<Vec<String>, String> {
        let bare = strip_brackets(host);
        if let Ok(ip) = bare.parse::<IpAddr>() {
            return Ok(vec![ip.to_string()]);
        }
        let addrs = tokio::net::lookup_host((bare, 0))
            .await
            .map_err(|e| e.to_string())?;
        Ok(addrs.map(|addr| addr.ip().to_string()).collect())
    }

    fn is_allowed(&self, address: &str) -> bool {
        is_public_address(address)
    }

    fn shape(&self, url: &Url) -> Result<(), UrlRejection> {
        check_url_shape(url)
    }
}

/// Why a fetch failed: the kind, the HTTP-like status and the sentence to show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailKind {
    /// The address was refused before any dial.
    Refused,
    /// The host or the site could not be reached.
    Unreachable,
    /// The site answered, but not with a readable page.
    Upstream,
    /// The body was over the limit.
    TooLarge,
}

/// A failed fetch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchFailure {
    /// What went wrong.
    pub kind: FailKind,
    /// HTTP-like status code.
    pub status: u16,
    /// Sentence shown to the user.
    pub message: String,
}

/// A fetched body and the response facts the paste fetches read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fetched {
    /// The final URL after redirects.
    pub url: String,
    /// HTTP status of the final response.
    pub status: u16,
    /// The `content-type` header, or empty.
    pub content_type: String,
    /// The body, at most `max_bytes` long.
    pub body: Vec<u8>,
}

/// What one fetch asks for: the `Accept` header and the limits.
#[derive(Debug, Clone)]
pub struct FetchOptions {
    /// The `Accept` header sent.
    pub accept: String,
    /// Redirect, size and time limits.
    pub limits: FetchLimits,
}

/// The browser-like `User-Agent` sent with every hop.
pub const BROWSER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/// Shown when the wall-clock budget runs out.
pub const TOO_SLOW: &str = "That site took too long to answer.";

/// Scheme test for user input: a letter, then letters, digits, `+`, `.` or `-`, then a colon
/// not followed by a digit (so `example.com:8443` is a host and a port).
fn has_scheme_prefix(input: &str) -> bool {
    let mut chars = input.chars().peekable();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    while let Some(c) = chars.next() {
        if c == ':' {
            return !chars.peek().is_some_and(char::is_ascii_digit);
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

/// Parses what a person typed, adding `https://` when there is no scheme.
#[must_use]
pub fn parse_fetch_input(input: &str) -> Option<Url> {
    let trimmed = input.trim_matches(is_js_space);
    if trimmed.is_empty() {
        return None;
    }
    if has_scheme_prefix(trimmed) {
        Url::parse(trimmed).ok()
    } else {
        Url::parse(&format!("https://{trimmed}")).ok()
    }
}

/// The size label in megabytes, rounded half up as JS `Math.round` does.
#[must_use]
pub fn mb_label(max_bytes: usize) -> usize {
    max_bytes.saturating_add(524_288) / 1_048_576
}

/// Checks one hop and returns the first address, which is the one dialled.
pub async fn check_reachable<N: Network>(net: &N, url: &Url) -> Result<IpAddr, FetchFailure> {
    net.shape(url).map_err(refused)?;
    let host = url.host_str().unwrap_or("");
    let addresses = net
        .resolve(strip_brackets(host))
        .await
        .map_err(|e| could_not_resolve(host, &e))?;
    if addresses.is_empty() {
        return Err(unresolved());
    }
    if !addresses.iter().all(|address| net.is_allowed(address)) {
        return Err(refused(UrlRejection::PrivateAddress));
    }
    addresses
        .first()
        .and_then(|address| address.parse::<IpAddr>().ok())
        .ok_or_else(unresolved)
}

/// Fetches `input` through `net`, following redirects one hop at a time and re-checking each.
pub async fn safe_fetch_via<N: Network>(
    net: &N,
    input: &str,
    options: &FetchOptions,
) -> Result<Fetched, FetchFailure> {
    let mut url = parse_fetch_input(input).ok_or_else(|| refused(UrlRejection::NotAUrl))?;
    let started = Instant::now();
    for _ in 0..=options.limits.max_redirects {
        let remaining = options.limits.timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return Err(too_slow());
        }
        let address = check_reachable(net, &url).await?;
        let response = send_hop(&url, address, remaining, &options.accept).await?;
        if response.status().is_redirection() {
            url = next_hop(&url, &response)?;
            continue;
        }
        if !response.status().is_success() {
            return Err(status_failure(response.status().as_u16()));
        }
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let body = read_capped(response, &url, options.limits.max_bytes).await?;
        return Ok(Fetched {
            url: url.to_string(),
            status,
            content_type,
            body,
        });
    }
    Err(upstream(502, "That address redirected too many times."))
}

/// `safe_fetch_via` on the real network.
pub async fn safe_fetch(input: &str, options: &FetchOptions) -> Result<Fetched, FetchFailure> {
    safe_fetch_via(&PublicNetwork, input, options).await
}

/// Drops one pair of `[` `]` around an IPv6 literal.
fn strip_brackets(host: &str) -> &str {
    host.strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(host)
}

/// Sends one GET pinned to `address`, with redirects off and the hop's remaining time as timeout.
async fn send_hop(
    url: &Url,
    address: IpAddr,
    remaining: Duration,
    accept: &str,
) -> Result<Response, FetchFailure> {
    let host = url.host_str().unwrap_or("");
    let port = url.port_or_known_default().unwrap_or(443);
    let client = Client::builder()
        .redirect(Policy::none())
        // A proxy cannot reach the address this hop is pinned to.
        .no_proxy()
        .timeout(remaining)
        .resolve(strip_brackets(host), SocketAddr::new(address, port))
        .build()
        .map_err(|e| reach_failure(url, &e))?;
    client
        .get(url.as_str())
        .header("User-Agent", BROWSER_AGENT)
        .header("Accept", accept)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| reach_failure(url, &e))
}

/// The URL a redirect points to, joined onto the current one.
fn next_hop(current: &Url, response: &Response) -> Result<Url, FetchFailure> {
    let location = response
        .headers()
        .get("location")
        .and_then(|value| std::str::from_utf8(value.as_bytes()).ok())
        .ok_or_else(|| upstream(502, "That site redirected to nowhere."))?;
    current.join(location).map_err(|_| {
        let head: String = location.chars().take(200).collect();
        upstream(
            502,
            format!("That site redirected somewhere unreadable: {head}"),
        )
    })
}

/// Reads the body up to `max_bytes`, refusing early when the declared length is over it.
async fn read_capped(
    mut response: Response,
    url: &Url,
    max_bytes: usize,
) -> Result<Vec<u8>, FetchFailure> {
    let limit = u64::try_from(max_bytes).unwrap_or(u64::MAX);
    if response
        .content_length()
        .is_some_and(|declared| declared > limit)
    {
        return Err(too_large(max_bytes));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| reach_failure(url, &e))? {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(too_large(max_bytes));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// The sentence for a non-2xx answer.
fn status_failure(status: u16) -> FetchFailure {
    let hint = match status {
        403 => "the site blocked automated access".to_owned(),
        404 => "the page was not found".to_owned(),
        _ => format!("it answered {status}"),
    };
    upstream(status, format!("Could not read that page: {hint}."))
}

/// The host as the user sees it: with `:port` only when a port is explicit.
fn host_with_port(url: &Url) -> String {
    let host = url.host_str().unwrap_or("");
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_owned(),
    }
}

/// A network error on one hop, shown in the "could not be reached" form.
fn reach_failure(url: &Url, error: &reqwest::Error) -> FetchFailure {
    let detail = if error.is_timeout() {
        TOO_SLOW.to_owned()
    } else {
        error.to_string()
    };
    could_not_reach(format!(
        "That site could not be reached: {} ({detail}).",
        host_with_port(url)
    ))
}

fn could_not_resolve(host: &str, error: &str) -> FetchFailure {
    could_not_reach(format!(
        "That host could not be resolved: {host} ({error})."
    ))
}

fn too_large(max_bytes: usize) -> FetchFailure {
    failure(
        FailKind::TooLarge,
        413,
        format!("That file is over the {} MB limit.", mb_label(max_bytes)),
    )
}

fn too_slow() -> FetchFailure {
    failure(FailKind::Unreachable, 504, TOO_SLOW)
}

fn refused(reason: UrlRejection) -> FetchFailure {
    failure(FailKind::Refused, 400, describe_rejection(reason))
}

fn unresolved() -> FetchFailure {
    failure(
        FailKind::Unreachable,
        502,
        "That host could not be resolved.",
    )
}

fn could_not_reach(message: impl Into<String>) -> FetchFailure {
    failure(FailKind::Unreachable, 502, message)
}

fn upstream(status: u16, message: impl Into<String>) -> FetchFailure {
    failure(FailKind::Upstream, status, message)
}

fn failure(kind: FailKind, status: u16, message: impl Into<String>) -> FetchFailure {
    FetchFailure {
        kind,
        status,
        message: message.into(),
    }
}

//! URL shape checks before a fetch. Ported from packages/core/src/net/url-safety.ts.

use std::time::Duration;

use reqwest::Url;

use crate::relay::address::{is_ip_address, is_public_address};

use super::is_js_space;

/// Why a URL is refused. `as_str` gives the TS code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrlRejection {
    /// Not parseable as a web address.
    NotAUrl,
    /// Scheme is not http or https.
    Scheme,
    /// Carries a username or password.
    Credentials,
    /// Port is not on the allowlist.
    Port,
    /// Literal address is not public.
    PrivateAddress,
    /// Host names this machine or an intranet.
    Hostname,
}

impl UrlRejection {
    /// The reason code shared with the TS side.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NotAUrl => "not-a-url",
            Self::Scheme => "scheme",
            Self::Credentials => "credentials",
            Self::Port => "port",
            Self::PrivateAddress => "private-address",
            Self::Hostname => "hostname",
        }
    }
}

/// Limits on one outbound fetch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FetchLimits {
    /// Redirect hops followed. Each one is re-checked.
    pub max_redirects: usize,
    /// Bytes read before the response is abandoned.
    pub max_bytes: usize,
    /// Wall-clock budget for the whole fetch, redirects included.
    pub timeout: Duration,
}

/// Enough for a page's head or a figure, not enough to be a download service.
pub const DEFAULT_FETCH_LIMITS: FetchLimits = FetchLimits {
    max_redirects: 4,
    max_bytes: 8 * 1024 * 1024,
    timeout: Duration::from_secs(10),
};

/// Ports worth reaching over http(s), plus the default. An allowlist: a blocklist is a game nobody wins.
const ALLOWED_PORTS: [u16; 6] = [80, 443, 8000, 8008, 8080, 8443];

/// Hostnames that mean "this machine" or "this network" whatever DNS says.
const BLOCKED_SUFFIXES: [&str; 5] = [".localhost", ".local", ".internal", ".home.arpa", ".onion"];
const BLOCKED_NAMES: [&str; 3] = ["localhost", "metadata.google.internal", "instance-data"];

/// Human-facing sentence for each rejection, shown to the person who pasted the URL.
#[must_use]
pub const fn describe_rejection(reason: UrlRejection) -> &'static str {
    match reason {
        UrlRejection::NotAUrl => "That is not a web address.",
        UrlRejection::Scheme => "Only http and https addresses can be fetched.",
        UrlRejection::Credentials => "Addresses carrying a username or password are not fetched.",
        UrlRejection::Port => "That port is not one WeaveForge will fetch from.",
        UrlRejection::PrivateAddress => {
            "That address is on a private network, so it is not fetched."
        }
        UrlRejection::Hostname => "That host is not reachable from the public internet.",
    }
}

/// Parses a URL, accepting a scheme-less host the way a person would type it.
#[must_use]
pub fn parse_user_url(input: &str) -> Option<Url> {
    let trimmed = input.trim_matches(is_js_space);
    if trimmed.is_empty() {
        return None;
    }
    if has_scheme(trimmed) {
        Url::parse(trimmed).ok()
    } else {
        Url::parse(&format!("https://{trimmed}")).ok()
    }
}

/// True for `[a-z][a-z0-9+.-]*:` (case-insensitive), the TS scheme test.
fn has_scheme(input: &str) -> bool {
    let mut chars = input.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

/// Everything that can be decided from the URL alone. The address check after DNS is separate.
#[must_use = "an unchecked URL may be fetched from inside the network"]
pub fn check_url_shape(url: &Url) -> Result<(), UrlRejection> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(UrlRejection::Scheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(UrlRejection::Credentials);
    }
    if url
        .port()
        .is_some_and(|port| !ALLOWED_PORTS.contains(&port))
    {
        return Err(UrlRejection::Port);
    }
    check_host(url.host_str().unwrap_or(""))
}

/// Parses then checks; a string that does not parse is `NotAUrl`.
#[must_use = "an unchecked URL may be fetched from inside the network"]
pub fn check_url_shape_str(input: &str) -> Result<(), UrlRejection> {
    let url = parse_user_url(input).ok_or(UrlRejection::NotAUrl)?;
    check_url_shape(&url)
}

/// Host-name rules and the literal-address check, for a host as `Url` reports it.
fn check_host(host_raw: &str) -> Result<(), UrlRejection> {
    let lowered = host_raw.to_ascii_lowercase();
    let host = lowered.strip_suffix('.').unwrap_or(lowered.as_str());
    if host.is_empty()
        || BLOCKED_NAMES.contains(&host)
        || BLOCKED_SUFFIXES
            .iter()
            .any(|suffix| host.ends_with(*suffix))
        || (!host.contains('.') && !host.contains(':'))
    {
        return Err(UrlRejection::Hostname);
    }
    let literal = host
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(host);
    if is_ip_address(literal) && !is_public_address(literal) {
        return Err(UrlRejection::PrivateAddress);
    }
    Ok(())
}

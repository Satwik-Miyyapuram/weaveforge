//! Server profile origins and `weaveforge://server` links (modes-093 section 3).
//! Pure: no I/O. The shell owns storage and the confirm screen.

use url::Url;

/// Why a server origin or link is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerProfileError {
    /// Not a parseable URL, or empty.
    Invalid,
    /// Only `https` origins are accepted.
    NotHttps,
    /// A username or password is embedded in the origin.
    HasCredentials,
    /// The origin carries a path other than `/`, a query or a fragment.
    HasPathOrQuery,
    /// The link is not a `weaveforge://server` link.
    NotServerLink,
}

/// A parsed `weaveforge://server?url=...&name=...` link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerLink {
    /// The normalised https origin.
    pub origin: String,
    /// The display name the link suggests, if any.
    pub name: Option<String>,
}

/// Normalises a server origin to `https://host[:port]`.
///
/// A trailing `/` is accepted and dropped; the host is lowercased and a
/// default port is removed by the URL parser.
pub fn parse_server_origin(input: &str) -> Result<String, ServerProfileError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ServerProfileError::Invalid);
    }
    let url = Url::parse(trimmed).map_err(|_| ServerProfileError::Invalid)?;
    if url.scheme() != "https" {
        return Err(ServerProfileError::NotHttps);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ServerProfileError::HasCredentials);
    }
    if (url.path() != "" && url.path() != "/") || url.query().is_some() || url.fragment().is_some()
    {
        return Err(ServerProfileError::HasPathOrQuery);
    }
    Ok(url.origin().ascii_serialization())
}

/// Parses `weaveforge://server?url=<https origin>[&name=<label>]`.
pub fn parse_server_link(link: &str) -> Result<ServerLink, ServerProfileError> {
    let url = Url::parse(link.trim()).map_err(|_| ServerProfileError::Invalid)?;
    if url.scheme() != "weaveforge" || url.host_str() != Some("server") {
        return Err(ServerProfileError::NotServerLink);
    }
    let mut origin_value = None;
    let mut name = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "url" => origin_value = Some(value.into_owned()),
            "name" => name = Some(value.trim().to_owned()).filter(|v| !v.is_empty()),
            _ => {}
        }
    }
    let origin = parse_server_origin(&origin_value.ok_or(ServerProfileError::Invalid)?)?;
    Ok(ServerLink { origin, name })
}

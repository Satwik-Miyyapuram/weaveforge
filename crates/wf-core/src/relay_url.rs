//! Ports `relayUrl` and `relayPath` in `apps/web/src/lib/relay-url.ts`. The
//! environment read and the desktop check stay in TS, which passes the usable
//! base in (`None` when relay routing is off).

/// The base as given, unless it is absent or empty (which means relay routing is off).
fn usable_base(base: Option<&str>) -> Option<&str> {
    base.filter(|value| !value.is_empty())
}

/// The URL a browser should request for a relay route `path`: the relay base
/// joined to the path, or the path alone when there is no base.
#[must_use]
pub fn relay_url(base: Option<&str>, path: &str) -> String {
    match usable_base(base) {
        Some(base) => format!("{base}{path}"),
        None => path.to_owned(),
    }
}

/// The relay route path inside `url`, so same-origin checks also accept a relay
/// URL. A `url` that is not under the base (base followed by `/`) comes back unchanged.
#[must_use]
pub fn relay_path(base: Option<&str>, url: &str) -> String {
    usable_base(base)
        .and_then(|base| url.strip_prefix(base))
        .filter(|rest| rest.starts_with('/'))
        .unwrap_or(url)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::{relay_path, relay_url};

    const BASE: &str = "https://relay.example.org";

    #[test]
    fn no_base_keeps_the_path() {
        assert_eq!(relay_url(None, "/api/arxiv"), "/api/arxiv");
        assert_eq!(relay_url(Some(""), "/api/arxiv"), "/api/arxiv");
        assert_eq!(relay_path(None, "/api/arxiv"), "/api/arxiv");
        assert_eq!(relay_path(Some(""), "https://x.test/a"), "https://x.test/a");
    }

    #[test]
    fn base_is_prepended() {
        assert_eq!(
            relay_url(Some(BASE), "/api/pdf-proxy"),
            "https://relay.example.org/api/pdf-proxy"
        );
    }

    #[test]
    fn relay_path_strips_the_base_only_at_a_path_boundary() {
        assert_eq!(
            relay_path(Some(BASE), "https://relay.example.org/api/arxiv?q=1"),
            "/api/arxiv?q=1"
        );
        assert_eq!(
            relay_path(Some(BASE), "https://relay.example.org.evil.test/x"),
            "https://relay.example.org.evil.test/x"
        );
        assert_eq!(
            relay_path(Some(BASE), "https://relay.example.org"),
            "https://relay.example.org"
        );
        assert_eq!(relay_path(Some(BASE), "/api/arxiv"), "/api/arxiv");
    }

    #[test]
    fn url_and_path_round_trip() {
        let url = relay_url(Some(BASE), "/api/arxiv");
        assert_eq!(relay_path(Some(BASE), &url), "/api/arxiv");
    }
}

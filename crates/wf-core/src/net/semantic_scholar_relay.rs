//! Semantic Scholar relay target: the upstream address for a relay path (TS
//! `apps/web/src/lib/semantic-scholar-relay.ts` `semanticScholarTarget`). The browser
//! path prefix and the upstream host are shared by the hosted route and the desktop shell.

/// The path the browser calls.
pub const RELAY_PREFIX: &str = "/api/semantic-scholar/";
const UPSTREAM: &str = "https://api.semanticscholar.org";

/// The upstream address for a relay path, or `None` when the path is not one.
///
/// No traversal, and no absolute target smuggled in the path: the destination is always
/// the upstream host plus the relay path's remainder.
#[must_use]
pub fn semantic_scholar_target(pathname: &str, search: &str) -> Option<String> {
    let rest = pathname.strip_prefix(RELAY_PREFIX)?;
    if rest.is_empty() || rest.contains("..") || rest.starts_with('/') || has_scheme(rest) {
        return None;
    }
    Some(format!("{UPSTREAM}/{rest}{search}"))
}

/// JS `/^[a-z]+:\/\//i` at the start: ASCII letters, then `://`.
fn has_scheme(rest: &str) -> bool {
    let letters = rest.bytes().take_while(u8::is_ascii_alphabetic).count();
    letters > 0 && rest[letters..].starts_with("://")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_and_query_map_onto_the_api_host() {
        assert_eq!(
            semantic_scholar_target("/api/semantic-scholar/graph/v1/paper/x", "?fields=title")
                .as_deref(),
            Some("https://api.semanticscholar.org/graph/v1/paper/x?fields=title"),
        );
    }

    #[test]
    fn empty_traversing_or_smuggled_paths_have_no_target() {
        for path in [
            "/api/semantic-scholar/",
            "/api/semantic-scholar/../etc",
            "/api/semantic-scholar/graph/..",
            "/api/semantic-scholar//evil.example/x",
            "/api/semantic-scholar/https://evil.example/x",
            "/api/semantic-scholar/HTTP://evil.example/x",
            "/api/other/graph/v1/paper/x",
        ] {
            assert_eq!(semantic_scholar_target(path, ""), None, "{path}");
        }
    }

    #[test]
    fn scheme_check_needs_letters_then_separator() {
        assert!(has_scheme("https://x"));
        assert!(!has_scheme("https:/x"));
        assert!(!has_scheme("1https://x"));
        assert!(!has_scheme("graph/https://x"));
    }
}

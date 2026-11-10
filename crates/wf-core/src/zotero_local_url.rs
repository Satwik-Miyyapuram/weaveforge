//! The one URL the desktop shell may proxy to the Zotero running on this machine (wf-core
//! `zotero_local_url`). Parity with the former TypeScript `isLocalZoteroUrl` in
//! `apps/desktop/src/zotero-local.ts`.

use url::Url;

/// The origin of the local Zotero API, with its port spelled out.
const LOCAL_ORIGIN: &str = "http://127.0.0.1:23119";

/// Whether `url` is the local Zotero API's own path (`/api` or below) on [`LOCAL_ORIGIN`], with
/// no credentials. Anything that does not parse is refused.
#[must_use]
pub fn is_local_zotero_url(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let path = parsed.path();
    parsed.origin().ascii_serialization() == LOCAL_ORIGIN
        && (path == "/api" || path.starts_with("/api/"))
        && parsed.username().is_empty()
        && parsed.password().unwrap_or("").is_empty()
}

#[cfg(test)]
mod tests {
    use super::is_local_zotero_url;

    #[test]
    fn accepts_the_local_api_path() {
        assert!(is_local_zotero_url(
            "http://127.0.0.1:23119/api/users/0/items"
        ));
        assert!(is_local_zotero_url("http://127.0.0.1:23119/api"));
        assert!(is_local_zotero_url("http://127.0.0.1:23119/api/"));
    }

    #[test]
    fn refuses_other_paths_on_the_same_origin() {
        assert!(!is_local_zotero_url(
            "http://127.0.0.1:23119/connector/ping"
        ));
        assert!(!is_local_zotero_url("http://127.0.0.1:23119/apifoo"));
        assert!(!is_local_zotero_url("http://127.0.0.1:23119/"));
    }

    #[test]
    fn refuses_other_hosts_ports_and_schemes() {
        assert!(!is_local_zotero_url("http://127.0.0.1:5432/api/items"));
        assert!(!is_local_zotero_url("http://localhost:23119/api/items"));
        assert!(!is_local_zotero_url("https://127.0.0.1:23119/api/items"));
        assert!(!is_local_zotero_url("http://evil.example/api/items"));
    }

    #[test]
    fn refuses_credentials() {
        assert!(!is_local_zotero_url(
            "http://user:pw@127.0.0.1:23119/api/items"
        ));
        assert!(!is_local_zotero_url(
            "http://user@127.0.0.1:23119/api/items"
        ));
    }

    #[test]
    fn refuses_what_does_not_parse() {
        assert!(!is_local_zotero_url("not a url"));
        assert!(!is_local_zotero_url(""));
    }
}

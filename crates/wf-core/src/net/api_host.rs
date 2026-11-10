//! Port of `isApiHost` in apps/desktop/src/api-cors.ts. Pure.

use url::Url;

/// True for `weaveforge.org` and its subdomains: the hosts whose responses the shell settles itself.
#[must_use]
pub fn is_api_host(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    parsed
        .host_str()
        .is_some_and(|host| host == "weaveforge.org" || host.ends_with(".weaveforge.org"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_api_host_and_its_subdomains_are_api_hosts() {
        assert!(is_api_host("https://api.weaveforge.org/auth/v1/token"));
        assert!(is_api_host("https://weaveforge.org/"));
    }

    #[test]
    fn other_hosts_and_lookalikes_are_not_api_hosts() {
        assert!(!is_api_host("https://export.arxiv.org/api/query"));
        assert!(!is_api_host("https://notweaveforge.org/"));
        assert!(!is_api_host("not a url"));
    }
}

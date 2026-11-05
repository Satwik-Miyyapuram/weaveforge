//! Sign-in App Link: where a provider sign-in returns on a phone.
//!
//! Phones cannot rely on a listening socket, so the browser returns to an
//! https link the app owns (Android App Links, iOS Universal Links). A custom
//! scheme is not used because any app can claim one. The page exchanges the
//! code itself (PKCE, verifier in its own storage); the shell only checks the
//! link and hands its query string on, as the desktop loopback does.

/// The host the sign-in link lives on.
pub const AUTH_LINK_HOST: &str = "app.weaveforge.org";
/// The path of the sign-in link.
pub const AUTH_LINK_PATH: &str = "/auth/app-callback";
/// The full link a provider returns to; the web app repeats it.
pub const AUTH_LINK_URL: &str = "https://app.weaveforge.org/auth/app-callback";

/// The query string (with its leading `?`) of a sign-in link, or `None`.
///
/// The link must be `https`, on exactly `AUTH_LINK_HOST` with no port, user
/// name or password, at exactly `AUTH_LINK_PATH`, with a non-empty query.
/// The fragment is dropped.
#[must_use]
pub fn callback_query(url: &tauri::Url) -> Option<String> {
    if url.scheme() != "https"
        || url.host_str() != Some(AUTH_LINK_HOST)
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != AUTH_LINK_PATH
    {
        return None;
    }
    let query = url.query().filter(|q| !q.is_empty())?;
    Some(format!("?{query}"))
}

/// The sign-in query of the newest callback link among `urls`, if any.
/// A cold start can hand over several links; the last one is the newest.
pub fn newest_callback_query(urls: &[tauri::Url]) -> Option<String> {
    urls.iter().rev().find_map(callback_query)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]
    use super::*;

    fn q(s: &str) -> Option<String> {
        callback_query(&tauri::Url::parse(s).expect("url"))
    }

    #[test]
    fn the_link_yields_its_query() {
        assert_eq!(
            q("https://app.weaveforge.org/auth/app-callback?code=abc&state=x"),
            Some("?code=abc&state=x".to_string())
        );
    }

    #[test]
    fn an_error_reply_is_passed_on() {
        assert_eq!(
            q(
                "https://app.weaveforge.org/auth/app-callback?error=access_denied&error_description=no"
            ),
            Some("?error=access_denied&error_description=no".to_string())
        );
    }

    #[test]
    fn the_fragment_is_dropped() {
        assert_eq!(
            q("https://app.weaveforge.org/auth/app-callback?code=a#frag"),
            Some("?code=a".to_string())
        );
    }

    #[test]
    fn the_constant_is_the_link() {
        let url = tauri::Url::parse(AUTH_LINK_URL).expect("url");
        assert_eq!(url.host_str(), Some(AUTH_LINK_HOST));
        assert_eq!(url.path(), AUTH_LINK_PATH);
    }

    #[test]
    fn other_links_are_refused() {
        for link in [
            "http://app.weaveforge.org/auth/app-callback?code=a",
            "https://evil.example/auth/app-callback?code=a",
            "https://app.weaveforge.org.evil.example/auth/app-callback?code=a",
            "https://sub.app.weaveforge.org/auth/app-callback?code=a",
            "https://app.weaveforge.org:8443/auth/app-callback?code=a",
            "https://user:pw@app.weaveforge.org/auth/app-callback?code=a",
            "https://user@app.weaveforge.org/auth/app-callback?code=a",
            "https://app.weaveforge.org/auth/app-callback/x?code=a",
            "https://app.weaveforge.org/auth/app-callbackx?code=a",
            "https://app.weaveforge.org/auth/callback?code=a",
            "https://app.weaveforge.org/auth/app-callback",
            "https://app.weaveforge.org/auth/app-callback?",
            "weaveforge://app.weaveforge.org/auth/app-callback?code=a",
        ] {
            assert_eq!(q(link), None, "{link}");
        }
    }

    #[test]
    fn the_default_port_is_the_same_link() {
        assert_eq!(
            q("https://app.weaveforge.org:443/auth/app-callback?code=a"),
            Some("?code=a".to_string())
        );
    }

    fn urls(list: &[&str]) -> Vec<tauri::Url> {
        list.iter()
            .map(|s| tauri::Url::parse(s).expect("url"))
            .collect()
    }

    #[test]
    fn no_links_yield_no_query() {
        assert_eq!(newest_callback_query(&[]), None);
    }

    #[test]
    fn one_good_link_yields_its_query() {
        let link = "https://app.weaveforge.org/auth/app-callback?code=abc&state=x";
        assert_eq!(
            newest_callback_query(&urls(&[link])),
            callback_query(&tauri::Url::parse(link).expect("url"))
        );
    }

    #[test]
    fn the_last_good_link_is_the_newest() {
        assert_eq!(
            newest_callback_query(&urls(&[
                "https://app.weaveforge.org/auth/app-callback?code=a",
                "https://evil.example/auth/app-callback?code=x",
                "https://app.weaveforge.org/auth/app-callback?code=b",
            ])),
            Some("?code=b".to_string())
        );
    }

    #[test]
    fn only_bad_links_yield_no_query() {
        assert_eq!(
            newest_callback_query(&urls(&[
                "https://evil.example/auth/app-callback?code=a",
                "http://app.weaveforge.org/auth/app-callback?code=b",
            ])),
            None
        );
    }
}

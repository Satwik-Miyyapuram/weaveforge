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

/// Sign-in queries waiting for the page. While the page loads, its listener does not
/// exist, so queries are held and handed over, oldest first, once it has loaded.
#[derive(Default)]
pub struct SignInQueue(std::sync::Mutex<Held>);

#[derive(Default)]
struct Held {
    ready: bool,
    queries: Vec<String>,
    last: Option<String>,
}

impl SignInQueue {
    /// The query to hand over now, or `None` when it is held or repeats the previous one
    /// (a cold-start link can also arrive as an open event).
    pub fn offer(&self, query: String) -> Option<String> {
        let mut held = self.0.lock().ok()?;
        if held.last.as_deref() == Some(query.as_str()) {
            return None;
        }
        held.last = Some(query.clone());
        if held.ready {
            return Some(query);
        }
        held.queries.push(query);
        None
    }

    /// The page started (re)loading: hold queries until it has loaded.
    pub fn page_loading(&self) {
        if let Ok(mut held) = self.0.lock() {
            held.ready = false;
        }
    }

    /// The page has loaded: the held queries, oldest first.
    pub fn page_loaded(&self) -> Vec<String> {
        self.0.lock().map_or_else(
            |_| Vec::new(),
            |mut held| {
                held.ready = true;
                std::mem::take(&mut held.queries)
            },
        )
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]
    use super::*;

    #[test]
    fn queries_wait_for_the_page_in_order() {
        let queue = SignInQueue::default();
        assert_eq!(queue.offer("?code=1".into()), None);
        assert_eq!(queue.offer("?code=2".into()), None);
        assert_eq!(
            queue.page_loaded(),
            vec!["?code=1".to_string(), "?code=2".to_string()]
        );
        assert_eq!(queue.offer("?code=3".into()), Some("?code=3".to_string()));
        assert!(queue.page_loaded().is_empty());
    }

    #[test]
    fn a_reload_holds_queries_again() {
        let queue = SignInQueue::default();
        assert!(queue.page_loaded().is_empty());
        queue.page_loading();
        assert_eq!(queue.offer("?code=1".into()), None);
        assert_eq!(queue.page_loaded(), vec!["?code=1".to_string()]);
    }

    #[test]
    fn a_repeated_query_is_handed_over_once() {
        let queue = SignInQueue::default();
        assert_eq!(queue.offer("?code=1".into()), None);
        assert_eq!(queue.offer("?code=1".into()), None);
        assert_eq!(queue.page_loaded(), vec!["?code=1".to_string()]);
        assert_eq!(queue.offer("?code=1".into()), None);
    }

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

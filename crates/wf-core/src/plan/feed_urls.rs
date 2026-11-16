//! Where the plan calendar feed is served and the links a calendar app or widget uses.

use std::fmt::Write as _;

use serde::Serialize;
use url::Url;

const DEFAULT_FEED_ORIGIN: &str = "https://app.weaveforge.org";

/// The links to the plan feed: `webcal` opens straight in a calendar app, `ics` is the same feed over https, and `widget` is the summary JSON.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanFeedUrls {
    /// Opens straight in a calendar app.
    pub webcal: String,
    /// The same feed over https, for calendars that ask for a URL.
    pub ics: String,
    /// Widget data.
    pub widget: String,
}

/// Where the feed is served: `here` when `server_routes` and it is an http(s) URL, otherwise the origin of `configured`, otherwise the production app.
#[must_use]
pub fn plan_feed_origin(
    server_routes: bool,
    here: Option<&str>,
    configured: Option<&str>,
) -> String {
    if server_routes
        && let Some(here) = here.filter(|h| h.starts_with("http://") || h.starts_with("https://"))
    {
        return here.to_string();
    }
    configured.and_then(|c| Url::parse(c).ok()).map_or_else(
        || DEFAULT_FEED_ORIGIN.to_string(),
        |url| url.origin().ascii_serialization(),
    )
}

/// The feed links for `origin` and `token`. `include_done` and a positive `reminder_days` (floored) go in the query.
#[must_use]
pub fn plan_feed_urls(
    origin: &str,
    token: &str,
    include_done: bool,
    reminder_days: f64,
) -> PlanFeedUrls {
    let base = format!("{origin}/api/plan/feed/{}", encode_uri_component(token));
    let mut query = Vec::new();
    if include_done {
        query.push("done=1".to_string());
    }
    if reminder_days > 0.0 {
        query.push(format!("alarm={}", reminder_days.floor()));
    }
    let suffix = if query.is_empty() {
        String::new()
    } else {
        format!("?{}", query.join("&"))
    };
    let ics = format!("{base}/deadlines.ics{suffix}");
    let webcal = ics
        .strip_prefix("https:")
        .map(|rest| format!("webcal:{rest}"))
        .or_else(|| {
            ics.strip_prefix("http:")
                .map(|rest| format!("webcal:{rest}"))
        })
        .unwrap_or_else(|| ics.clone());
    let widget_query = if include_done { "?done=1" } else { "" };
    PlanFeedUrls {
        webcal,
        ics,
        widget: format!("{base}/widget.json{widget_query}"),
    }
}

/// Percent-encodes `value` as `encodeURIComponent` does, so a token in the path matches the TS links.
fn encode_uri_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_carry_options_in_query() {
        let urls = plan_feed_urls("https://app.weaveforge.org", "tt_abc", true, 3.0);
        assert_eq!(
            urls.ics,
            "https://app.weaveforge.org/api/plan/feed/tt_abc/deadlines.ics?done=1&alarm=3"
        );
        assert_eq!(urls.webcal, urls.ics.replacen("https:", "webcal:", 1));
        assert_eq!(
            urls.widget,
            "https://app.weaveforge.org/api/plan/feed/tt_abc/widget.json?done=1"
        );
    }

    #[test]
    fn plain_urls_have_no_query() {
        let urls = plan_feed_urls("https://x.org", "tt_a", false, 0.0);
        assert_eq!(urls.ics, "https://x.org/api/plan/feed/tt_a/deadlines.ics");
        assert_eq!(urls.widget, "https://x.org/api/plan/feed/tt_a/widget.json");
    }

    #[test]
    fn token_is_percent_encoded() {
        assert_eq!(encode_uri_component("a b/c"), "a%20b%2Fc");
    }

    #[test]
    fn origin_prefers_here_only_with_server_routes() {
        assert_eq!(
            plan_feed_origin(true, Some("https://preview.example.com"), None),
            "https://preview.example.com"
        );
        assert_eq!(
            plan_feed_origin(false, Some("app://weaveforge"), None),
            DEFAULT_FEED_ORIGIN
        );
        assert_eq!(
            plan_feed_origin(
                true,
                Some("app://weaveforge"),
                Some("https://c.example.com/x")
            ),
            "https://c.example.com"
        );
        assert_eq!(
            plan_feed_origin(false, None, Some("not a url")),
            DEFAULT_FEED_ORIGIN
        );
    }
}

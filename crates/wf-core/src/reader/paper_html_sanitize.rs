//! Lists and URL resolve for the paper-page sanitizer
//! (`apps/web/src/features/reader/infrastructure/sanitize-paper-html.ts`). DOMPurify and the DOM
//! walk stay in TS; this owns the page-furniture selectors, the forbidden tags and the
//! absolute-URL resolve.

use url::Url;

/// Page furniture that is never the paper.
pub const CHROME_SELECTORS: &[&str] = &[
    "script",
    "noscript",
    "style",
    "link",
    "nav",
    "header[role=banner]",
    "footer",
    "form",
    "[role=navigation]",
    "[role=search]",
    "[aria-hidden=true]",
    ".cookie-banner",
    "#cookie-banner",
];

/// Tags DOMPurify is told to drop on top of its own profile.
pub const FORBID_TAGS: &[&str] = &[
    "form", "input", "button", "select", "textarea", "option", "iframe", "frame", "frameset",
    "object", "embed", "applet", "style", "link", "meta", "base", "script", "noscript", "template",
    "dialog", "portal",
];

/// The page-furniture selector list, joined the way `querySelectorAll` takes it.
#[must_use]
pub fn chrome_selector() -> String {
    CHROME_SELECTORS.join(",")
}

/// `new URL(href, base).toString()`, or `None` where the browser constructor would throw.
#[must_use]
pub fn resolve_url(href: &str, base: &str) -> Option<String> {
    let base = Url::parse(base).ok()?;
    base.join(href).ok().map(|url| url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chrome_selector_joins_every_entry_in_order() {
        assert!(chrome_selector().starts_with("script,noscript,style,link,nav,"));
        assert!(chrome_selector().ends_with(",.cookie-banner,#cookie-banner"));
    }

    #[test]
    fn forbid_tags_drop_scripts_and_frames() {
        assert!(FORBID_TAGS.contains(&"script"));
        assert!(FORBID_TAGS.contains(&"iframe"));
    }

    #[test]
    fn resolve_url_makes_relative_links_absolute() {
        assert_eq!(
            resolve_url("../fig1.png", "https://example.org/a/b/paper.html").as_deref(),
            Some("https://example.org/a/fig1.png")
        );
    }

    #[test]
    fn resolve_url_none_for_unparseable_base() {
        assert_eq!(resolve_url("x.png", "not a url"), None);
    }
}

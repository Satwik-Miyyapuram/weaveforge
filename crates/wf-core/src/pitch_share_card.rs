//! The pitch link-preview card, ported from `apps/web/src/app/pitch/share-card.ts`.
//! Pure: the card text, the image size, the URL paths and the origin rule. The Next
//! `Metadata` object and `metadataBase` (a parsed `URL`) are built in TypeScript.

use serde::Serialize;
use url::Url;

/// Card and page title, shared by both hosts.
pub const PITCH_TITLE: &str = "WeaveForge — one workspace for research";

/// Card and page description, shared by both hosts.
pub const PITCH_DESCRIPTION: &str = "Papers, notes, plan, experiments and writing in one project, so the reasoning behind your research survives the years it takes to do it.";

/// The card image file, in `public/` on both hosts.
const OG_IMAGE: &str = "og.png";

/// The shipped deployment's origin: what an unset override means.
pub const DEFAULT_APP_ORIGIN: &str = "https://app.weaveforge.org";

const SITE_NAME: &str = "WeaveForge";
const LOCALE: &str = "en";
const IMAGE_WIDTH: u32 = 1200;
const IMAGE_HEIGHT: u32 = 630;

/// The shared text, for callers that build the card in another language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PitchShareConstants {
    /// [`PITCH_TITLE`].
    pub title: String,
    /// [`PITCH_DESCRIPTION`].
    pub description: String,
    /// [`DEFAULT_APP_ORIGIN`].
    pub default_app_origin: String,
}

/// The card image, as the Open Graph `images` entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PitchShareImage {
    /// Path to the image, prefixed with the base path and not with the origin.
    pub url: String,
    /// Image width in pixels.
    pub width: u32,
    /// Image height in pixels.
    pub height: u32,
    /// Alt text: the title with a full stop.
    pub alt: String,
}

/// The card metadata, minus `metadataBase`. Open Graph and Twitter share the title,
/// description and image.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PitchShareCard {
    /// Card title.
    pub title: String,
    /// Card description.
    pub description: String,
    /// Open Graph type (`website`).
    pub og_type: String,
    /// Open Graph site name.
    pub site_name: String,
    /// Open Graph locale.
    pub locale: String,
    /// Open Graph URL: the base path followed by the page path.
    pub url: String,
    /// The card image.
    pub image: PitchShareImage,
    /// Twitter card kind (`summary_large_image`).
    pub twitter_card: String,
}

/// The shared pitch text.
#[must_use]
pub fn pitch_share_constants() -> PitchShareConstants {
    PitchShareConstants {
        title: PITCH_TITLE.to_owned(),
        description: PITCH_DESCRIPTION.to_owned(),
        default_app_origin: DEFAULT_APP_ORIGIN.to_owned(),
    }
}

/// Resolve the origin an app deployment answers on. An unset or empty value means
/// [`DEFAULT_APP_ORIGIN`]. Only an absolute http(s) URL is honoured, and only its
/// origin (no path). Anything else falls back, so a mis-set variable does not fail a
/// build over a link-preview card.
#[must_use]
pub fn app_origin_from(configured: Option<&str>) -> String {
    let Some(raw) = configured.filter(|v| !v.is_empty()) else {
        return DEFAULT_APP_ORIGIN.to_owned();
    };
    match Url::parse(raw) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => url.origin().ascii_serialization(),
        _ => DEFAULT_APP_ORIGIN.to_owned(),
    }
}

/// Build the card for a host serving the pitch. `base_path` prefixes the image and the
/// page (a project site under `/<repo>/`). `path` is the page, after that prefix.
#[must_use]
pub fn pitch_share_card(base_path: &str, path: &str) -> PitchShareCard {
    PitchShareCard {
        title: PITCH_TITLE.to_owned(),
        description: PITCH_DESCRIPTION.to_owned(),
        og_type: "website".to_owned(),
        site_name: SITE_NAME.to_owned(),
        locale: LOCALE.to_owned(),
        url: format!("{base_path}{path}"),
        image: PitchShareImage {
            url: format!("{base_path}/{OG_IMAGE}"),
            width: IMAGE_WIDTH,
            height: IMAGE_HEIGHT,
            alt: format!("{PITCH_TITLE}."),
        },
        twitter_card: "summary_large_image".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_defaults_when_unset_or_empty() {
        assert_eq!(app_origin_from(None), DEFAULT_APP_ORIGIN);
        assert_eq!(app_origin_from(Some("")), DEFAULT_APP_ORIGIN);
    }

    #[test]
    fn origin_keeps_self_hosted_origin_and_drops_path() {
        assert_eq!(
            app_origin_from(Some("https://research.example.edu")),
            "https://research.example.edu"
        );
        assert_eq!(
            app_origin_from(Some("http://localhost:3000")),
            "http://localhost:3000"
        );
        assert_eq!(
            app_origin_from(Some("https://research.example.edu/pitch")),
            "https://research.example.edu"
        );
    }

    #[test]
    fn origin_ignores_values_that_are_not_absolute_http_urls() {
        for bad in [
            "/",
            "/pitch",
            "not a url",
            "app.example.org",
            "ftp://example.org",
            "file:///etc/passwd",
        ] {
            assert_eq!(app_origin_from(Some(bad)), DEFAULT_APP_ORIGIN, "{bad}");
        }
    }

    #[test]
    fn card_is_a_website_summary_with_the_shared_text() {
        let card = pitch_share_card("", "/");
        assert_eq!(card.title, PITCH_TITLE);
        assert_eq!(card.description, PITCH_DESCRIPTION);
        assert_eq!(card.og_type, "website");
        assert_eq!(card.site_name, "WeaveForge");
        assert_eq!(card.locale, "en");
        assert_eq!(card.twitter_card, "summary_large_image");
    }

    #[test]
    fn image_is_the_card_size_at_the_root() {
        let card = pitch_share_card("", "/");
        assert_eq!(card.image.url, "/og.png");
        assert_eq!(card.image.width, 1200);
        assert_eq!(card.image.height, 630);
        assert_eq!(card.image.alt, "WeaveForge — one workspace for research.");
    }

    #[test]
    fn base_path_prefixes_the_image_and_the_page_and_nothing_else() {
        let card = pitch_share_card("/weaveforge", "/");
        assert_eq!(card.image.url, "/weaveforge/og.png");
        assert_eq!(card.url, "/weaveforge/");
    }

    #[test]
    fn each_host_names_its_own_page() {
        assert_eq!(pitch_share_card("", "/").url, "/");
        assert_eq!(pitch_share_card("", "/pitch").url, "/pitch");
    }

    #[test]
    fn constants_match_the_card() {
        let c = pitch_share_constants();
        assert_eq!(c.title, PITCH_TITLE);
        assert_eq!(c.description, PITCH_DESCRIPTION);
        assert_eq!(c.default_app_origin, "https://app.weaveforge.org");
    }
}

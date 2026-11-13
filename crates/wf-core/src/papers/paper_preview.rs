//! What the paper page shows in its preview frame, and where the frame leads
//! (TS `features/papers/application/paper-preview.ts`).
//!
//! The preview comes from what is on this device: the first page of a saved PDF,
//! or the title and site of a saved web page. Either one opens in the reader.

use serde::{Deserialize, Serialize};

/// The preview frame's state for one paper.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PaperPreview {
    /// Not drawn yet.
    Loading,
    /// The first page of a saved PDF, as an image URL.
    Pdf {
        /// Object URL of the drawn first page.
        image_url: String,
    },
    /// A saved web page: its title and site.
    Page {
        /// The page's title.
        title: String,
        /// The host the page came from, without `www.`.
        site: String,
    },
    /// Nothing to show.
    #[serde(rename = "none")]
    Nothing,
}

/// The reader link for the paper, or `None` when there is nothing it could open.
///
/// A non-empty remote link wins. Otherwise a saved PDF or saved page opens at
/// `local_href`; anything else has no link.
#[must_use]
pub fn preview_reader_href(
    remote_href: Option<&str>,
    preview: &PaperPreview,
    local_href: &str,
) -> Option<String> {
    if let Some(remote) = remote_href.filter(|h| !h.is_empty()) {
        return Some(remote.to_owned());
    }
    match preview {
        PaperPreview::Pdf { .. } | PaperPreview::Page { .. } => Some(local_href.to_owned()),
        PaperPreview::Loading | PaperPreview::Nothing => None,
    }
}

/// The host a saved page came from, without a leading `www.`, or the address as given
/// when it does not parse.
#[must_use]
pub fn site_of(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(parsed) => {
            let host = parsed.host_str().unwrap_or("");
            host.strip_prefix("www.").unwrap_or(host).to_owned()
        }
        Err(_) => url.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCAL: &str = "/workspace?locus=p1";

    #[test]
    fn remote_link_wins() {
        assert_eq!(
            preview_reader_href(Some("/remote"), &PaperPreview::Nothing, LOCAL),
            Some("/remote".to_owned())
        );
    }

    #[test]
    fn empty_remote_link_is_no_link() {
        assert_eq!(
            preview_reader_href(Some(""), &PaperPreview::Nothing, LOCAL),
            None
        );
    }

    #[test]
    fn saved_pdf_and_page_open_locally() {
        let pdf = PaperPreview::Pdf {
            image_url: "blob:x".to_owned(),
        };
        let page = PaperPreview::Page {
            title: "T".to_owned(),
            site: "example.org".to_owned(),
        };
        assert_eq!(
            preview_reader_href(None, &pdf, LOCAL),
            Some(LOCAL.to_owned())
        );
        assert_eq!(
            preview_reader_href(None, &page, LOCAL),
            Some(LOCAL.to_owned())
        );
    }

    #[test]
    fn nothing_to_open_has_no_link() {
        assert_eq!(
            preview_reader_href(None, &PaperPreview::Nothing, LOCAL),
            None
        );
        assert_eq!(
            preview_reader_href(None, &PaperPreview::Loading, LOCAL),
            None
        );
    }

    #[test]
    fn site_drops_www() {
        assert_eq!(site_of("https://www.example.org/post/1"), "example.org");
        assert_eq!(site_of("not a url"), "not a url");
    }
}

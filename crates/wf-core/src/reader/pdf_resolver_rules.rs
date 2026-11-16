//! Trim and presence rules for the open-access and WebDAV PDF ladder steps (TS
//! `OpenAccessPdfResolver` and `WebDavPdfResolver` in `packages/core/src/reader/`).
//! The fetch and the URL builders stay in TS; only the "does this step apply" and
//! "is this URL usable" decisions live here.

use crate::search::js_text::is_js_whitespace;

/// The trimmed value when non-empty, else none (JS `value?.trim()` then falsy check).
#[must_use]
pub fn trimmed_or_none(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim_matches(is_js_whitespace);
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn has_text(value: Option<&str>) -> bool {
    trimmed_or_none(value).is_some()
}

/// Open-access step applies when the paper has an arXiv id, a URL or a DOI.
#[must_use]
pub fn open_access_supports(arxiv_id: Option<&str>, url: Option<&str>, doi: Option<&str>) -> bool {
    has_text(arxiv_id) || has_text(url) || has_text(doi)
}

/// WebDAV step applies when metadata `webdavPath` is a string with non-blank text.
/// The caller passes `None` for a non-string value.
#[must_use]
pub fn webdav_supports(webdav_path: Option<&str>) -> bool {
    has_text(webdav_path)
}

#[cfg(test)]
mod tests {
    use super::{open_access_supports, trimmed_or_none, webdav_supports};

    #[test]
    fn trimmed_or_none_trims_and_drops_blank() {
        assert_eq!(
            trimmed_or_none(Some("  https://e.com/a.pdf ")),
            Some("https://e.com/a.pdf".to_owned())
        );
        assert_eq!(trimmed_or_none(Some("   ")), None);
        assert_eq!(trimmed_or_none(Some("")), None);
        assert_eq!(trimmed_or_none(None), None);
    }

    #[test]
    fn open_access_needs_one_non_blank_identifier() {
        assert!(open_access_supports(Some("2401.00001"), None, None));
        assert!(open_access_supports(None, Some(" https://e.com "), None));
        assert!(open_access_supports(None, None, Some("10.1/x")));
        assert!(!open_access_supports(Some("  "), Some(""), None));
        assert!(!open_access_supports(None, None, None));
    }

    #[test]
    fn webdav_supports_non_blank_path_only() {
        assert!(webdav_supports(Some("/Papers/a.pdf")));
        assert!(!webdav_supports(Some("   ")));
        assert!(!webdav_supports(None));
    }
}

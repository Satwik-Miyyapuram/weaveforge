//! The reference popover's one-line status, tied to the entry it is about. A faithful port of
//! `apps/web/src/features/reader/application/reference-notice.ts`.
//!
//! A range like `[2-4]` shows several entries in one popover, one tab each. The notice is keyed by
//! entry index so that "Added to library" under one entry does not show under the next.

use serde::{Deserialize, Serialize};

/// The notice shown under one entry (TS `ReferenceNotice`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReferenceNotice {
    /// Index of the entry the notice describes.
    pub index: u32,
    /// The status text.
    pub text: String,
}

/// The notice to show under `entry_index`, or `None` when it is about another entry.
#[must_use]
pub fn notice_for(notice: Option<&ReferenceNotice>, entry_index: u32) -> Option<&str> {
    notice
        .filter(|n| n.index == entry_index)
        .map(|n| n.text.as_str())
}

/// What an add says: a dedupe that found the paper already there did not add it.
#[must_use]
pub fn added_notice(created: bool) -> &'static str {
    if created {
        "Added to library"
    } else {
        "Already in library"
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    #[test]
    fn a_notice_shows_only_under_the_entry_it_is_about() {
        let notice = ReferenceNotice {
            index: 9,
            text: "Added to library".to_owned(),
        };
        assert_eq!(notice_for(Some(&notice), 9), Some("Added to library"));
        assert_eq!(notice_for(Some(&notice), 10), None);
        assert_eq!(notice_for(None, 9), None);
    }

    #[test]
    fn an_add_that_found_the_paper_already_there_does_not_claim_it_added_it() {
        assert_eq!(added_notice(true), "Added to library");
        assert_eq!(added_notice(false), "Already in library");
    }
}

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

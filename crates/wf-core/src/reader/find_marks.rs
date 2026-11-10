//! Scrollbar tick positions for find matches. Port of `findMarks` in
//! `apps/web/src/features/reader/application/find-marks.ts`. The caller supplies each loaded
//! page's text and height up front, so this runs without callbacks.

use serde::{Deserialize, Serialize};

use super::reference_locate::locate_mention;
use super::selection::SelectionPageTextItem;
use super::text_units::as_f64;

/// One find match, as `findMarks` reads it (TS `DocumentSearchMatch`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FindMarkMatch {
    /// Zero-based page the match sits on.
    pub page_index: f64,
    /// Start offset into that page's text.
    pub start: f64,
    /// Exclusive end offset into that page's text.
    pub end: f64,
}

/// A loaded page's text and height. A page with no entry has no text and no height.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FindMarkPage {
    /// Zero-based page the entry describes.
    pub page_index: f64,
    /// The page's text runs, when loaded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub items: Option<Vec<SelectionPageTextItem>>,
    /// The page's height in PDF user space.
    pub height: f64,
}

/// One tick on the scrollbar strip (TS `FindMark`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FindMark {
    /// Index into the match list, so the current match can be drawn differently.
    pub index: f64,
    /// Fraction of the whole document, top to bottom.
    pub fraction: f64,
}

/// Where each match falls in the document, as a fraction of its full height. Pages count as
/// equal in height. A match whose page text is not loaded sits at the top of its page.
#[must_use]
pub fn find_marks(
    matches: &[FindMarkMatch],
    num_pages: f64,
    pages: &[FindMarkPage],
) -> Vec<FindMark> {
    if num_pages <= 0.0 {
        return Vec::new();
    }
    matches
        .iter()
        .enumerate()
        .map(|(index, found)| {
            let within = pages
                .iter()
                .find(|page| page.page_index == found.page_index)
                .map_or(0.0, |page| within_page(page, found));
            FindMark {
                index: as_f64(index),
                fraction: (found.page_index + within) / num_pages,
            }
        })
        .collect()
}

/// How far down its page a match's top edge sits, from 0 to 1. Zero when the text or height is
/// missing, or the match has no geometry.
fn within_page(page: &FindMarkPage, found: &FindMarkMatch) -> f64 {
    let (Some(items), height) = (page.items.as_deref(), page.height) else {
        return 0.0;
    };
    // NaN fails the comparison, as `!(height > 0.0)` did.
    if height.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
        return 0.0;
    }
    match locate_mention(items, found.start, found.end).bounds {
        // PDF y runs upward; the top of the box is `bounds[3]`.
        Some(bounds) => (1.0 - bounds[3] / height).clamp(0.0, 1.0),
        None => 0.0,
    }
}

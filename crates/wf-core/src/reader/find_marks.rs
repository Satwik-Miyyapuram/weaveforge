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

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn items() -> Vec<SelectionPageTextItem> {
        vec![
            SelectionPageTextItem {
                str: "top line".to_owned(),
                transform: vec![10.0, 0.0, 0.0, 10.0, 50.0, 700.0],
                width: Some(40.0),
                height: Some(10.0),
                has_eol: Some(true),
                font_name: None,
            },
            SelectionPageTextItem {
                str: "bottom line".to_owned(),
                transform: vec![10.0, 0.0, 0.0, 10.0, 50.0, 100.0],
                width: Some(55.0),
                height: Some(10.0),
                has_eol: None,
                font_name: None,
            },
        ]
    }

    #[test]
    fn match_on_second_of_four_pages_lands_in_second_quarter() {
        let page = FindMarkPage {
            page_index: 1.0,
            items: Some(items()),
            height: 800.0,
        };
        let matches = [FindMarkMatch {
            page_index: 1.0,
            start: 9.0,
            end: 15.0,
        }];
        let marks = find_marks(&matches, 4.0, &[page]);
        assert_eq!(marks.len(), 1);
        let f = marks[0].fraction;
        assert!(f > 0.25 && f < 0.5, "fraction {f}");
        // "bottom line" sits at y=100 of 800, near the foot of the page.
        assert!(f > 0.25 + 0.8 / 4.0, "fraction {f}");
    }

    #[test]
    fn without_page_text_the_mark_sits_at_the_top_of_its_page() {
        let page = FindMarkPage {
            page_index: 2.0,
            items: None,
            height: 800.0,
        };
        let matches = [FindMarkMatch {
            page_index: 2.0,
            start: 0.0,
            end: 3.0,
        }];
        let marks = find_marks(&matches, 4.0, &[page]);
        assert_eq!(marks[0].fraction, 0.5);
    }

    #[test]
    fn no_pages_gives_no_marks() {
        let page = FindMarkPage {
            page_index: 0.0,
            items: Some(items()),
            height: 800.0,
        };
        let matches = [FindMarkMatch {
            page_index: 0.0,
            start: 0.0,
            end: 1.0,
        }];
        assert_eq!(find_marks(&matches, 0.0, &[page]), Vec::<FindMark>::new());
    }
}

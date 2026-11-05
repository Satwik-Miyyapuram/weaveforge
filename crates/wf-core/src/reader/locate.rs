//! Lasso hit-testing, in-document text search and next/prev match stepping. A faithful port of packages/core/src/reader/ink-lasso.ts, document-search.ts.
//!
//! Stays in TS: `encodeLocus` / `decodeLocus` (locus-link.ts). Their clamp slices UTF-16 units (lone surrogates), they pass unknown fields through, and decode falls back to `decodeURIComponent`, which Rust strings cannot match exactly. Also stays in TS: the pointer and DOM glue in use-page-pointer.ts.

// A port of JS number code: `!(x > 0.0)` keeps the TS NaN handling, and index
// casts mirror JS numbers used as indices, all bounded by slice lengths.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_lossless
)]

use serde::{Deserialize, Serialize};

use crate::search::js_text::is_js_whitespace;

/// The share of a stroke's points a loop must hold for it to be caught (TS `LASSO_CAUGHT_SHARE`).
pub const LASSO_CAUGHT_SHARE: f64 = 0.6;

/// Even-odd point-in-polygon over flat `x, y` pairs (TS `pointInPolygon`).
#[must_use]
pub fn point_in_polygon(polygon: &[f64], x: f64, y: f64) -> bool {
    let count = polygon.len() / 2;
    if count < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = count - 1;
    for i in 0..count {
        let xi = polygon[i * 2];
        let yi = polygon[i * 2 + 1];
        let xj = polygon[j * 2];
        let yj = polygon[j * 2 + 1];
        if (yi > y) != (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Whether a loop has caught a stroke: at least `share` of its finite points inside (TS `inkPathsInPolygon`).
///
/// Each path is flat `x, y` pairs; a trailing odd value is ignored, as in TS.
#[must_use]
pub fn ink_paths_in_polygon(paths: &[&[f64]], polygon: &[f64], share: f64) -> bool {
    let mut points = 0usize;
    let mut caught = 0usize;
    for path in paths {
        for &[x, y] in path.as_chunks::<2>().0 {
            if !x.is_finite() || !y.is_finite() {
                continue;
            }
            points += 1;
            if point_in_polygon(polygon, x, y) {
                caught += 1;
            }
        }
    }
    points > 0 && (caught as f64) / (points as f64) >= share
}

/// One page's extracted text (TS `DocumentPageText`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DocumentPageText {
    /// Zero-based page index, passed through unchanged.
    pub page_index: f64,
    /// The page's text.
    pub text: String,
}

/// A hit in a page's text (TS `DocumentSearchMatch`). Offsets are UTF-16 code units.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DocumentSearchMatch {
    /// The page the hit is on.
    pub page_index: f64,
    /// Inclusive start offset into that page's text.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub start: usize,
    /// Exclusive end offset.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub end: usize,
}

/// Case-insensitive full-document search over page texts (TS `findDocumentMatches`).
/// Empty / whitespace-only queries return no matches.
#[must_use]
pub fn find_document_matches(pages: &[DocumentPageText], query: &str) -> Vec<DocumentSearchMatch> {
    // The query is lowercased as a whole string, as TS does, so final sigma applies.
    let needle: Vec<u16> = query
        .trim_matches(is_js_whitespace)
        .to_lowercase()
        .encode_utf16()
        .collect();
    if needle.is_empty() {
        return Vec::new();
    }
    let mut matches = Vec::new();
    for page in pages {
        let (hay, starts, ends) = fold_case(&page.text);
        let mut from = 0usize;
        while let Some(idx) = find_from(&hay, &needle, from) {
            matches.push(DocumentSearchMatch {
                page_index: page.page_index,
                start: starts[idx],
                end: ends[idx + needle.len() - 1],
            });
            from = idx + needle.len();
        }
    }
    matches
}

/// Position of `needle` in `hay` at or after `from`, as `indexOf` finds it.
fn find_from(hay: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    hay.get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|p| p + from)
}

/// Lowercases each code point, keeping for each folded unit the UTF-16 span of its source letter.
fn fold_case(text: &str) -> (Vec<u16>, Vec<usize>, Vec<usize>) {
    let mut hay = Vec::new();
    let mut starts = Vec::new();
    let mut ends = Vec::new();
    let mut at = 0usize;
    for ch in text.chars() {
        let width = ch.len_utf16();
        let mut buf = [0u16; 2];
        for low in ch.to_lowercase() {
            for &unit in low.encode_utf16(&mut buf).iter() {
                hay.push(unit);
                starts.push(at);
                ends.push(at + width);
            }
        }
        at += width;
    }
    (hay, starts, ends)
}

/// Wraparound next/prev index into a match list; -1 when empty (TS `nextMatchIndex`).
#[must_use]
#[allow(clippy::float_cmp)]
pub fn next_match_index(current: f64, total: f64, direction: f64) -> f64 {
    if !total.is_finite() || total <= 0.0 {
        return -1.0;
    }
    if !current.is_finite() || current < 0.0 {
        return if direction == 1.0 { 0.0 } else { total - 1.0 };
    }
    (current + direction + total) % total
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A square loop, 100 wide, from (0,0) to (100,100).
    const SQUARE: [f64; 8] = [0.0, 0.0, 100.0, 0.0, 100.0, 100.0, 0.0, 100.0];

    fn page(index: f64, text: &str) -> DocumentPageText {
        DocumentPageText {
            page_index: index,
            text: text.to_string(),
        }
    }

    fn slice16(text: &str, start: usize, end: usize) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&units[start..end]).unwrap_or_default()
    }

    #[test]
    fn a_point_is_in_the_loop_or_it_is_not_up_to_the_loops_own_line() {
        assert!(point_in_polygon(&SQUARE, 50.0, 50.0));
        assert!(!point_in_polygon(&SQUARE, -1.0, 50.0));
        assert!(!point_in_polygon(&SQUARE, 50.0, 101.0));
        assert!(point_in_polygon(&SQUARE, 99.5, 50.0));
        assert!(!point_in_polygon(&SQUARE, 100.5, 50.0));
    }

    #[test]
    fn a_loop_with_too_few_points_holds_nothing() {
        assert!(!point_in_polygon(&[0.0, 0.0, 10.0, 10.0], 5.0, 5.0));
        assert!(!ink_paths_in_polygon(
            &[&[0.0, 0.0, 10.0, 10.0]],
            &[0.0, 0.0, 10.0, 10.0],
            LASSO_CAUGHT_SHARE
        ));
    }

    #[test]
    fn a_stroke_is_caught_when_most_of_it_is_inside_the_loop() {
        let inside = [10.0, 10.0, 50.0, 50.0, 90.0, 90.0];
        assert!(ink_paths_in_polygon(
            &[&inside],
            &SQUARE,
            LASSO_CAUGHT_SHARE
        ));
    }

    #[test]
    fn a_stroke_that_merely_crosses_the_loop_is_not_caught() {
        let through_line = [
            -500.0, 50.0, -100.0, 50.0, 50.0, 50.0, 100.0, 50.0, 500.0, 50.0,
        ];
        assert!(!ink_paths_in_polygon(
            &[&through_line],
            &SQUARE,
            LASSO_CAUGHT_SHARE
        ));
        assert!(ink_paths_in_polygon(
            &[&[10.0, 50.0, 50.0, 50.0, 90.0, 50.0]],
            &SQUARE,
            LASSO_CAUGHT_SHARE
        ));
        let just_under = [10.0, 50.0, 50.0, 50.0, 150.0, 50.0, 250.0, 50.0];
        const { assert!(2.0 / 4.0 < LASSO_CAUGHT_SHARE) };
        assert!(!ink_paths_in_polygon(
            &[&just_under],
            &SQUARE,
            LASSO_CAUGHT_SHARE
        ));
    }

    #[test]
    fn a_multi_stroke_mark_is_judged_on_all_of_its_strokes_together() {
        assert!(!ink_paths_in_polygon(
            &[&[10.0, 10.0, 90.0, 90.0], &[500.0, 500.0, 600.0, 600.0]],
            &SQUARE,
            LASSO_CAUGHT_SHARE
        ));
        assert!(ink_paths_in_polygon(
            &[&[10.0, 10.0, 90.0, 90.0], &[20.0, 20.0, 80.0, 80.0]],
            &SQUARE,
            LASSO_CAUGHT_SHARE
        ));
    }

    #[test]
    fn points_that_are_not_numbers_are_skipped_rather_than_counted_against_it() {
        assert!(ink_paths_in_polygon(
            &[&[f64::NAN, 0.0, 50.0, 50.0, 60.0, 60.0]],
            &SQUARE,
            LASSO_CAUGHT_SHARE
        ));
        assert!(!ink_paths_in_polygon(&[&[]], &SQUARE, LASSO_CAUGHT_SHARE));
    }

    #[test]
    fn find_document_matches_is_case_insensitive_and_ordered() {
        let matches = find_document_matches(
            &[page(0.0, "Alpha beta ALPHA"), page(1.0, "gamma alpha")],
            "alpha",
        );
        assert_eq!(
            matches,
            vec![
                DocumentSearchMatch {
                    page_index: 0.0,
                    start: 0,
                    end: 5
                },
                DocumentSearchMatch {
                    page_index: 0.0,
                    start: 11,
                    end: 16
                },
                DocumentSearchMatch {
                    page_index: 1.0,
                    start: 6,
                    end: 11
                },
            ]
        );
    }

    #[test]
    fn find_document_matches_skips_blank_queries() {
        assert!(find_document_matches(&[page(0.0, "x")], "  ").is_empty());
    }

    #[test]
    fn next_match_index_wraps() {
        assert_eq!(next_match_index(0.0, 3.0, 1.0), 1.0);
        assert_eq!(next_match_index(2.0, 3.0, 1.0), 0.0);
        assert_eq!(next_match_index(0.0, 3.0, -1.0), 2.0);
        assert_eq!(next_match_index(-1.0, 3.0, 1.0), 0.0);
        assert_eq!(next_match_index(0.0, 0.0, 1.0), -1.0);
    }

    #[test]
    fn match_offsets_stay_on_the_original_text_when_lowercasing_changes_length() {
        let dot_i = '\u{130}';
        let text = format!("{dot_i}stanbul Stra\u{df}e meets the target");
        let hit = find_document_matches(&[page(0.0, &text)], "target")[0].clone();
        assert_eq!(slice16(&text, hit.start, hit.end), "target");
        let city = find_document_matches(&[page(0.0, &text)], "stanbul")[0].clone();
        assert_eq!(slice16(&text, city.start, city.end), "stanbul");
        let street = find_document_matches(&[page(0.0, &text)], &"STRASSE"[..4])[0].clone();
        assert_eq!(slice16(&text, street.start, street.end), "Stra");
        let whole =
            find_document_matches(&[page(0.0, &text)], &format!("{dot_i}stanbul"))[0].clone();
        assert_eq!(
            slice16(&text, whole.start, whole.end),
            format!("{dot_i}stanbul")
        );
    }

    #[test]
    fn a_match_that_ends_inside_a_lowercased_letter_covers_that_whole_letter() {
        let dot_i = '\u{130}';
        let text = format!("x{dot_i}y");
        let hit = find_document_matches(&[page(0.0, &text)], "xi")[0].clone();
        assert_eq!(slice16(&text, hit.start, hit.end), format!("x{dot_i}"));
    }
}

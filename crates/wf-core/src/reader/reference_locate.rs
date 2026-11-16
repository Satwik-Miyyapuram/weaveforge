//! Turn mention character offsets into page geometry. Port of `locateMention` and `unionRect` in
//! `apps/web/src/features/reader/application/reference-locate.ts`. Output is PDF user space
//! (origin bottom-left), like stored annotation rects.

use super::citation_spans::{mention_item_ranges, to_index};
use super::selection::{SelectionPageTextItem, item_to_rect};

/// `[x0, y0, x1, y1]` in PDF user space.
pub type PdfRect = [f64; 4];

/// Geometry for one mention: one rect per text run it spans, plus their union.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MentionGeometry {
    /// One rect per text run the mention spans, in reading order.
    pub rects: Vec<PdfRect>,
    /// Union of `rects`; `None` when there are none.
    pub bounds: Option<PdfRect>,
}

/// Rects covering `[start, end)` of the page text. Out-of-range or empty ranges yield no geometry
/// rather than a guess.
#[must_use]
pub fn locate_mention(items: &[SelectionPageTextItem], start: f64, end: f64) -> MentionGeometry {
    let mut rects: Vec<PdfRect> = Vec::new();
    for range in mention_item_ranges(items, start, end) {
        let Some(item) = items.get(to_index(range.item_index)) else {
            continue;
        };
        if let Some(rect) = item_to_rect(item, range.from, range.to)
            && rect.len() == 4
        {
            rects.push([rect[0], rect[1], rect[2], rect[3]]);
        }
    }
    let bounds = union_rect(&rects);
    MentionGeometry { rects, bounds }
}

/// Smallest rect containing every input rect, or `None` when given none.
#[must_use]
pub fn union_rect(rects: &[PdfRect]) -> Option<PdfRect> {
    let first = rects.first()?;
    let mut out = *first;
    for rect in rects {
        out[0] = out[0].min(rect[0]);
        out[1] = out[1].min(rect[1]);
        out[2] = out[2].max(rect[2]);
        out[3] = out[3].max(rect[3]);
    }
    Some(out)
}

// Port of `reference-locate.test.ts`; the offset-space agreement case is TS-side plumbing.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn item(
        text: &str,
        x: f64,
        y: f64,
        width: f64,
        has_eol: Option<bool>,
    ) -> SelectionPageTextItem {
        SelectionPageTextItem {
            str: text.to_owned(),
            transform: vec![10.0, 0.0, 0.0, 10.0, x, y],
            width: Some(width),
            height: Some(10.0),
            has_eol,
            font_name: None,
        }
    }

    /// Three runs: `see [12]`, `and` (end of line), `[13]`. Page text `"see [12]and\n[13]"`.
    fn items() -> Vec<SelectionPageTextItem> {
        vec![
            item("see [12]", 72.0, 700.0, 40.0, None),
            item("and", 72.0, 680.0, 18.0, Some(true)),
            item("[13]", 90.0, 680.0, 20.0, None),
        ]
    }

    #[test]
    fn mention_inside_one_run_is_narrowed_to_its_own_characters() {
        let geometry = locate_mention(&items(), 4.0, 8.0);
        assert_eq!(geometry.rects, vec![[92.0, 700.0, 112.0, 710.0]]);
        assert_eq!(geometry.bounds, Some([92.0, 700.0, 112.0, 710.0]));
    }

    #[test]
    fn mention_covering_a_whole_run_uses_the_run_full_width() {
        assert_eq!(
            locate_mention(&items(), 0.0, 8.0).rects,
            vec![[72.0, 700.0, 112.0, 710.0]]
        );
    }

    #[test]
    fn mention_spanning_a_line_break_yields_one_rect_per_run() {
        let geometry = locate_mention(&items(), 9.0, 14.0);
        assert_eq!(
            geometry.rects,
            vec![[78.0, 680.0, 90.0, 690.0], [90.0, 680.0, 100.0, 690.0]]
        );
        assert_eq!(geometry.bounds, Some([78.0, 680.0, 100.0, 690.0]));
    }

    #[test]
    fn empty_reversed_or_unmeasurable_range_paints_nothing() {
        assert!(locate_mention(&items(), 8.0, 8.0).rects.is_empty());
        assert!(locate_mention(&items(), 10.0, 2.0).rects.is_empty());
        assert!(locate_mention(&items(), f64::NAN, 12.0).rects.is_empty());
        assert!(locate_mention(&items(), 8.0, 8.0).bounds.is_none());
    }

    #[test]
    fn range_past_the_end_of_the_page_paints_nothing() {
        assert!(locate_mention(&items(), 40.0, 60.0).rects.is_empty());
    }

    #[test]
    fn zero_length_runs_advance_no_geometry_and_do_not_shift_the_cursor() {
        let mut with_blank = vec![item("", 72.0, 700.0, 0.0, None)];
        with_blank.extend(items());
        assert_eq!(
            locate_mention(&with_blank, 4.0, 8.0).rects,
            vec![[92.0, 700.0, 112.0, 710.0]]
        );
    }

    #[test]
    fn union_rect_is_none_with_nothing_to_union_and_reaches_every_corner() {
        assert_eq!(union_rect(&[]), None);
        assert_eq!(
            union_rect(&[[10.0, 20.0, 30.0, 40.0], [5.0, 25.0, 12.0, 60.0]]),
            Some([5.0, 20.0, 30.0, 60.0])
        );
    }
}

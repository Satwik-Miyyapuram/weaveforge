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

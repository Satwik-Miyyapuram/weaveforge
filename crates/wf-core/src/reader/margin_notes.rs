//! Margin comment cards down the page margin. A port of `layoutMarginNotes` in
//! `apps/web/src/features/reader/application/parts-2.ts`.
//!
//! TS reads each annotation's fields into a [`MarginMark`]. Which marks get a card, where
//! each mark starts on screen, and the stacking all live here.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

use super::annotation_helpers::ReaderAnnotation;
use super::picture::picture_path;
use super::text_units::is_js_space;
use super::viewport::{ReaderPageProjection, pdf_rect_to_screen_box};

/// Vertical gap, in pixels, between two stacked cards.
pub const MARGIN_NOTE_GAP: f64 = 8.0;

/// Where one card sits: its index in the input, its stacked top, and where its mark starts.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MarginSlot {
    /// Index of the card's mark in the input slice.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub index: usize,
    /// Top of the card after stacking.
    pub top: f64,
    /// Top of the mark the card belongs to, before stacking.
    pub anchor_top: f64,
}

/// Stacks cards of `card_height` down the margin, one per entry of `anchor_tops`.
///
/// Cards come back in ascending `anchor_top` order (ties keep input order). Each card sits
/// level with its mark and is pushed down only as far as the card above it needs.
#[must_use]
pub fn stack_margin_notes(anchor_tops: &[f64], card_height: f64) -> Vec<MarginSlot> {
    let mut order: Vec<usize> = (0..anchor_tops.len()).collect();
    order.sort_by(|&a, &b| {
        anchor_tops[a]
            .partial_cmp(&anchor_tops[b])
            .unwrap_or(Ordering::Equal)
    });
    let mut floor = 0.0_f64;
    order
        .into_iter()
        .map(|index| {
            let anchor_top = anchor_tops[index];
            let top = anchor_top.max(floor);
            floor = top + card_height + MARGIN_NOTE_GAP;
            MarginSlot {
                index,
                top,
                anchor_top,
            }
        })
        .collect()
}

/// The geometry of an annotation's first mark, from its zotero position. Rects are flat
/// `[x1, y1, x2, y2]`; a rect with fewer than four numbers is ignored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MarkGeometry {
    /// Rectangles, each flat `[x1, y1, x2, y2]` in PDF user space.
    pub rects: Vec<Vec<f64>>,
    /// Freehand paths, each flat `[x, y, x, y, ...]` in PDF user space.
    pub paths: Vec<Vec<f64>>,
}

/// One annotation as margin layout reads it. TS fills it from the annotation; the rules are here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MarginMark {
    /// True when the comment has text after trimming.
    pub has_comment: bool,
    /// True for a placed picture: it is drawn on the page, not in the margin.
    pub has_picture: bool,
    /// The mark's geometry; None when the annotation has no zotero position.
    pub geometry: Option<MarkGeometry>,
}

/// JavaScript `Math.min`: a NaN on either side gives NaN.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

/// JavaScript `Math.max`: a NaN on either side gives NaN.
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// The top of a mark on screen: the highest of its rects and path boxes, or None when that
/// is not a finite number.
fn mark_top(geometry: &MarkGeometry, p: ReaderPageProjection) -> Option<f64> {
    let mut top = f64::INFINITY;
    for rect in &geometry.rects {
        if rect.len() < 4 {
            continue;
        }
        top = js_min(
            top,
            pdf_rect_to_screen_box([rect[0], rect[1], rect[2], rect[3]], p).top,
        );
    }
    for path in &geometry.paths {
        let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
        let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
        let mut i = 0;
        while i + 1 < path.len() {
            x0 = js_min(x0, path[i]);
            x1 = js_max(x1, path[i]);
            y0 = js_min(y0, path[i + 1]);
            y1 = js_max(y1, path[i + 1]);
            i += 2;
        }
        if x0 <= x1 {
            top = js_min(top, pdf_rect_to_screen_box([x0, y0, x1, y1], p).top);
        }
    }
    top.is_finite().then_some(top)
}

/// Margin cards for one page: which marks get a card, and where each card sits. A card is
/// level with its mark and is pushed down only as far as the card above it needs. Each
/// returned slot's `index` is the mark's position in `marks`.
#[must_use]
pub fn layout_margin_notes(
    marks: &[MarginMark],
    projection: ReaderPageProjection,
    card_height: f64,
) -> Vec<MarginSlot> {
    let mut indices: Vec<usize> = Vec::new();
    let mut anchor_tops: Vec<f64> = Vec::new();
    for (index, mark) in marks.iter().enumerate() {
        // Marks without a comment are not shown: the margin is for what was said about the page.
        if !mark.has_comment || mark.has_picture {
            continue;
        }
        let Some(top) = mark.geometry.as_ref().and_then(|g| mark_top(g, projection)) else {
            continue;
        };
        indices.push(index);
        anchor_tops.push(top);
    }
    stack_margin_notes(&anchor_tops, card_height)
        .into_iter()
        .map(|slot| MarginSlot {
            index: indices[slot.index],
            ..slot
        })
        .collect()
}

/// The marks a page's annotations make: a comment with text asks for a card, a placed picture
/// is drawn instead, and the zotero position says where the mark sits.
#[must_use]
pub fn margin_marks(annotations: &[ReaderAnnotation]) -> Vec<MarginMark> {
    annotations
        .iter()
        .map(|annotation| {
            let comment = annotation.comment.as_deref().unwrap_or("");
            MarginMark {
                has_comment: !comment.trim_matches(is_js_space).is_empty(),
                has_picture: picture_path(&annotation.kind, Some(comment)).is_some(),
                geometry: annotation
                    .anchor
                    .zotero_position
                    .as_ref()
                    .map(|position| MarkGeometry {
                        rects: position.rects.clone().unwrap_or_default(),
                        paths: position.paths.clone().unwrap_or_default(),
                    }),
            }
        })
        .collect()
}

/// [`layout_margin_notes`] over a page's annotations. Each slot's `index` is the annotation's
/// position in `annotations`.
#[must_use]
pub fn layout_annotation_margin_notes(
    annotations: &[ReaderAnnotation],
    projection: ReaderPageProjection,
    card_height: f64,
) -> Vec<MarginSlot> {
    layout_margin_notes(&margin_marks(annotations), projection, card_height)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::viewport::pdf_rect_to_screen_box;

    #[allow(clippy::needless_pass_by_value, reason = "keeps call sites terse")]
    fn annotation(
        id: &str,
        comment: &str,
        rects: Option<Vec<Vec<f64>>>,
        paths: Option<Vec<Vec<f64>>>,
    ) -> ReaderAnnotation {
        let kind = if rects.is_some() { "highlight" } else { "ink" };
        serde_json::from_value(serde_json::json!({
            "id": id,
            "origin": "local",
            "type": kind,
            "color": "#ff0",
            "text": "",
            "comment": comment,
            "tags": [],
            "sortIndex": id,
            "createdAt": "",
            "updatedAt": "",
            "anchor": { "zoteroPosition": { "pageIndex": 0, "rects": rects, "paths": paths } },
        }))
        .expect("annotation fixture")
    }

    fn slots_as_pairs(
        slots: &[MarginSlot],
        annotations: &[ReaderAnnotation],
    ) -> Vec<(String, f64)> {
        slots
            .iter()
            .map(|slot| (annotations[slot.index].id.clone(), slot.top))
            .collect()
    }

    // it: "only commented marks get a card, level with the mark"
    #[test]
    fn only_commented_marks_get_a_card_level_with_the_mark() {
        let annotations = vec![
            annotation("a", "", Some(vec![vec![10.0, 700.0, 100.0, 720.0]]), None),
            annotation(
                "b",
                "why",
                Some(vec![vec![10.0, 500.0, 100.0, 520.0]]),
                None,
            ),
        ];
        let slots = layout_annotation_margin_notes(&annotations, PAGE, CARD);
        assert_eq!(
            slots_as_pairs(&slots, &annotations),
            vec![("b".to_owned(), 280.0)]
        );
    }

    // it: "cards that would overlap stack downwards in page order"
    #[test]
    fn cards_that_would_overlap_stack_downwards_in_page_order() {
        let annotations = vec![
            annotation(
                "low",
                "2",
                Some(vec![vec![10.0, 680.0, 100.0, 700.0]]),
                None,
            ),
            annotation(
                "high",
                "1",
                Some(vec![vec![10.0, 700.0, 100.0, 720.0]]),
                None,
            ),
        ];
        let slots = layout_annotation_margin_notes(&annotations, PAGE, CARD);
        assert_eq!(
            slots_as_pairs(&slots, &annotations),
            vec![("high".to_owned(), 80.0), ("low".to_owned(), 152.0)]
        );
    }

    // it: "an ink stroke's card sits at the top of the stroke"
    #[test]
    fn an_ink_strokes_card_sits_at_the_top_of_the_stroke() {
        let annotations = vec![annotation(
            "s",
            "note",
            None,
            Some(vec![vec![50.0, 100.0, 60.0, 300.0, 70.0, 200.0]]),
        )];
        let slots = layout_annotation_margin_notes(&annotations, PAGE, CARD);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].top, 500.0);
    }

    // it: "a placed picture is drawn on the page, not in the margin"
    #[test]
    fn a_placed_picture_gets_no_margin_card() {
        let mut picture = annotation(
            "p",
            "![picture](fig.png)",
            Some(vec![vec![10.0, 500.0, 100.0, 520.0]]),
            None,
        );
        picture.kind = "image".to_owned();
        assert!(layout_annotation_margin_notes(&[picture], PAGE, CARD).is_empty());
    }

    const PAGE: ReaderPageProjection = ReaderPageProjection {
        page_width: 600.0,
        page_height: 800.0,
        scale: 1.0,
        rotation: 0.0,
    };
    const CARD: f64 = 64.0;

    fn rect_mark(rect: [f64; 4]) -> MarginMark {
        MarginMark {
            has_comment: true,
            has_picture: false,
            geometry: Some(MarkGeometry {
                rects: vec![rect.to_vec()],
                paths: vec![],
            }),
        }
    }

    #[test]
    fn a_lone_card_sits_level_with_its_mark() {
        let rect = [10.0, 100.0, 50.0, 120.0];
        let slots = layout_margin_notes(&[rect_mark(rect)], PAGE, CARD);
        let top = pdf_rect_to_screen_box(rect, PAGE).top;
        assert_eq!(
            slots,
            vec![MarginSlot {
                index: 0,
                top,
                anchor_top: top
            }]
        );
    }

    #[test]
    fn marks_without_comment_picture_or_position_get_no_card() {
        let rect = [10.0, 100.0, 50.0, 120.0];
        let no_comment = MarginMark {
            has_comment: false,
            ..rect_mark(rect)
        };
        let picture = MarginMark {
            has_picture: true,
            ..rect_mark(rect)
        };
        let no_geometry = MarginMark {
            geometry: None,
            ..rect_mark(rect)
        };
        let short_rect = MarginMark {
            geometry: Some(MarkGeometry {
                rects: vec![vec![1.0, 2.0]],
                paths: vec![],
            }),
            ..rect_mark(rect)
        };
        // The top comes from the y values, so they are the ones that must be NaN.
        let nan_rect = rect_mark([1.0, f64::NAN, 2.0, f64::NAN]);
        let slots = layout_margin_notes(
            &[no_comment, picture, no_geometry, short_rect, nan_rect],
            PAGE,
            CARD,
        );
        assert!(slots.is_empty());
    }

    #[test]
    fn overlapping_cards_stack_and_keep_their_mark_index() {
        let rect = [10.0, 100.0, 50.0, 120.0];
        let marks = [
            rect_mark(rect),
            MarginMark {
                has_comment: false,
                ..rect_mark(rect)
            },
            rect_mark(rect),
        ];
        let slots = layout_margin_notes(&marks, PAGE, CARD);
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].index, 0);
        assert_eq!(slots[1].index, 2);
        assert_eq!(slots[1].anchor_top, slots[0].anchor_top);
        assert_eq!(slots[1].top, slots[0].top + CARD + MARGIN_NOTE_GAP);
    }

    #[test]
    fn a_path_is_placed_by_its_bounding_box() {
        let path = vec![10.0, 300.0, 40.0, 200.0, 25.0, 250.0];
        let mark = MarginMark {
            has_comment: true,
            has_picture: false,
            geometry: Some(MarkGeometry {
                rects: vec![],
                paths: vec![path],
            }),
        };
        let slots = layout_margin_notes(&[mark], PAGE, CARD);
        let expected = pdf_rect_to_screen_box([10.0, 200.0, 40.0, 300.0], PAGE).top;
        assert_eq!(slots[0].anchor_top, expected);
    }
}

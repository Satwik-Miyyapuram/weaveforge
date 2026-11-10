//! Draft builders for local reader annotations (`reader::annotation_draft`).
//! Port of `apps/web/src/features/reader/application/draft-local-annotation.ts`.
//! Pure geometry only: the DOM and the pdf.js sampler stay in TS.

use serde::{Deserialize, Serialize};

use super::anchor::{AnchorCombinedPdf, AnchorPdfLocus, AnchorQuoteSelector, AnchorZoteroPosition};
use super::ink_stroke::{
    INK_DEFAULT_WIDTH, INK_MAX_PATHS_PER_ANNOTATION, ReaderCompactInkOptions, clamp_ink_width,
    compact_ink_path, ink_paths_hit_test,
};
use super::selection::{
    SelectionPageTextGeometry, SelectionPageTextItem, SelectionTextRange, selection_to_anchor,
};
use super::viewport::build_annotation_sort_index;
use crate::ink::js_math;

/// Simplification tolerance applied before an ink stroke is stored (TS `PDF_INK_SAVE_TOLERANCE`).
pub const PDF_INK_SAVE_TOLERANCE: f64 = 0.1;

/// A local annotation before it is stored (TS `NewReaderAnnotation`, the fields the drafts set).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewReaderAnnotation {
    /// Annotation kind: `highlight`, `underline`, `note`, `ink`, `image` or `text`.
    #[serde(rename = "type")]
    pub kind: String,
    /// Colour as CSS text.
    pub color: String,
    /// Quoted or typed text; empty for ink and images, and when absent.
    #[serde(default)]
    pub text: String,
    /// Comment; absent for drafts that take none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Tags; absent means none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Zero-based page index.
    pub page_index: f64,
    /// Where the annotation sits; empty when absent.
    #[serde(default)]
    pub anchor: AnchorCombinedPdf,
    /// Zotero-style sort key; empty or absent means one is built from the page.
    #[serde(default)]
    pub sort_index: String,
}

/// A text-layer selection draft (TS `draftFromTextSelection` input). `kind` is one of
/// `highlight`, `underline` or `note`; the TS type enforces that, so it is not re-checked here.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextSelectionDraft {
    /// Annotation kind.
    #[serde(rename = "type")]
    pub kind: String,
    /// Colour as CSS text.
    pub color: String,
    /// The selection.
    pub selection: SelectionTextRange,
    /// The page the selection is on.
    pub page: TextSelectionPage,
    /// Comment to store with the annotation.
    #[serde(default)]
    pub comment: Option<String>,
    /// Rects measured from the DOM, replacing the text-derived rects when non-empty.
    #[serde(default)]
    pub exact_rects: Option<Vec<Vec<f64>>>,
    /// Rects on the following page, for a highlight that spills over.
    #[serde(default)]
    pub next_page_rects: Option<Vec<Vec<f64>>>,
    /// Full text across pages; replaces the quote when non-empty.
    #[serde(default)]
    pub full_text: Option<String>,
}

/// The page geometry a selection draft needs (TS `PageTextGeometry`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextSelectionPage {
    /// Zero-based page index.
    pub page_index: f64,
    /// Unrotated page height in PDF units; sets the sort index's top.
    pub page_height: f64,
    /// Text items in reading order.
    #[serde(default)]
    pub items: Vec<SelectionPageTextItem>,
    /// Hash of the PDF the geometry came from.
    #[serde(default)]
    pub content_hash: Option<String>,
}

/// An ink draft (TS `draftInkAnnotation` input).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InkDraft {
    /// Colour as CSS text.
    pub color: String,
    /// Zero-based page index.
    pub page_index: f64,
    /// Unrotated page height in PDF units.
    pub page_height: f64,
    /// Flat `[x,y,...]` PDF user-space path, as captured.
    pub path: Vec<f64>,
    /// Nib width in PDF units; a highlighter is simply a wide one.
    #[serde(default)]
    pub width: Option<f64>,
}

/// An image-region draft (TS `draftImageRegion` input).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ImageRegionDraft {
    /// Colour as CSS text.
    pub color: String,
    /// Zero-based page index.
    pub page_index: f64,
    /// Unrotated page height in PDF units.
    pub page_height: f64,
    /// PDF user-space rect `[x1,y1,x2,y2]`.
    pub rect: [f64; 4],
    /// Minimum width/height in PDF units; default 2.
    #[serde(default)]
    pub min_size: Option<f64>,
}

/// A text-box draft (TS `draftTextBox` input).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextBoxDraft {
    /// Colour as CSS text.
    pub color: String,
    /// Zero-based page index.
    pub page_index: f64,
    /// Unrotated page height in PDF units.
    pub page_height: f64,
    /// The typed text.
    pub text: String,
    /// PDF user-space x of the box's bottom-left corner.
    pub x: f64,
    /// PDF user-space y of the box's bottom-left corner.
    pub y: f64,
    /// Box width in PDF units; default 120.
    #[serde(default)]
    pub width: Option<f64>,
    /// Box height in PDF units; default 24.
    #[serde(default)]
    pub height: Option<f64>,
}

/// A PDF rect as the bottom-left corner and size a draft takes (TS `textBoxFromRect`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextBoxRect {
    /// Left edge.
    pub x: f64,
    /// Bottom edge.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

/// Draft a highlight, underline or note from a text selection. Port of TS `draftFromTextSelection`.
#[must_use]
pub fn draft_from_text_selection(input: &TextSelectionDraft) -> Option<NewReaderAnnotation> {
    let geometry = SelectionPageTextGeometry {
        page_index: Some(input.page.page_index),
        items: input.page.items.clone(),
        content_hash: input.page.content_hash.clone(),
    };
    let mut anchor = selection_to_anchor(&input.selection, &geometry)?;

    if let Some(exact) = input.exact_rects.as_ref().filter(|r| !r.is_empty())
        && let Some(position) = anchor.zotero_position.as_mut()
    {
        position.rects = Some(exact.clone());
    }
    if let Some(next) = input.next_page_rects.as_ref().filter(|r| !r.is_empty())
        && let Some(position) = anchor.zotero_position.as_mut()
    {
        position.next_page_rects = Some(next.clone());
    }
    if let Some(full) = input.full_text.as_deref().filter(|s| !s.is_empty())
        && let Some(locus) = anchor.locus.as_mut()
    {
        locus.quote.exact = Some(full.to_owned());
    }

    let quote = anchor
        .locus
        .as_ref()
        .and_then(|l| l.quote.exact.clone())
        .unwrap_or_default();
    let char_start = anchor
        .locus
        .as_ref()
        .and_then(|l| l.position.as_ref())
        .and_then(|p| p.start)
        .unwrap_or(0.0);
    let top = match anchor
        .zotero_position
        .as_ref()
        .and_then(|p| p.rects.as_ref())
        .and_then(|rects| rects.first())
    {
        Some(rect) => {
            let y1 = rect.get(1).copied().unwrap_or(f64::NAN);
            let y3 = rect.get(3).copied().unwrap_or(f64::NAN);
            input.page.page_height - js_math::max(y1, y3)
        }
        None => 0.0,
    };
    let text = input
        .full_text
        .as_deref()
        .filter(|s| !s.is_empty())
        .map_or(quote, str::to_owned);

    Some(NewReaderAnnotation {
        kind: input.kind.clone(),
        color: input.color.clone(),
        text,
        comment: Some(input.comment.clone().unwrap_or_default()),
        tags: Vec::new(),
        page_index: input.page.page_index,
        anchor,
        sort_index: build_annotation_sort_index(input.page.page_index, char_start, top),
    })
}

/// Draft an ink annotation. Compacts the path before storing. Port of TS `draftInkAnnotation`.
#[must_use]
pub fn draft_ink_annotation(input: &InkDraft) -> Option<NewReaderAnnotation> {
    let path = compact_ink_path(
        &input.path,
        &ReaderCompactInkOptions {
            tolerance: Some(PDF_INK_SAVE_TOLERANCE),
            ..ReaderCompactInkOptions::default()
        },
    );
    if path.len() < 4 {
        return None;
    }
    let top_pdf = path
        .iter()
        .skip(1)
        .step_by(2)
        .copied()
        .fold(f64::NEG_INFINITY, js_math::max);
    let top = input.page_height - top_pdf;
    let width = clamp_ink_width(input.width.unwrap_or(INK_DEFAULT_WIDTH));
    Some(NewReaderAnnotation {
        kind: "ink".to_owned(),
        color: input.color.clone(),
        text: String::new(),
        comment: None,
        tags: Vec::new(),
        page_index: input.page_index,
        anchor: AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(input.page_index),
                paths: Some(vec![path]),
                width: Some(width),
                ..AnchorZoteroPosition::default()
            }),
            ..AnchorCombinedPdf::default()
        },
        sort_index: build_annotation_sort_index(input.page_index, 0.0, top),
    })
}

/// Add a stroke to an existing ink anchor. Returns `None` when the stroke does not belong
/// there (full annotation, no paths, or nothing drawable). Port of TS `appendInkStroke`.
#[must_use]
pub fn append_ink_stroke(anchor: &AnchorCombinedPdf, path: &[f64]) -> Option<AnchorCombinedPdf> {
    let position = anchor.zotero_position.as_ref()?;
    let paths = position.paths.as_ref()?;
    if paths.len() as f64 >= INK_MAX_PATHS_PER_ANNOTATION {
        return None;
    }
    let compact = compact_ink_path(
        path,
        &ReaderCompactInkOptions {
            tolerance: Some(PDF_INK_SAVE_TOLERANCE),
            ..ReaderCompactInkOptions::default()
        },
    );
    if compact.len() < 4 {
        return None;
    }
    let mut next_paths = paths.clone();
    next_paths.push(compact);
    let mut next = anchor.clone();
    next.zotero_position = Some(AnchorZoteroPosition {
        paths: Some(next_paths),
        ..position.clone()
    });
    Some(next)
}

/// Rub out the strokes of an ink anchor that pass within `radius` of a point. Returns the
/// anchor unchanged when nothing was hit, the trimmed anchor when some remain, and `None`
/// when all were removed. Port of TS `eraseInkPaths`.
#[must_use]
pub fn erase_ink_paths(
    anchor: AnchorCombinedPdf,
    x: f64,
    y: f64,
    radius: f64,
) -> Option<AnchorCombinedPdf> {
    let Some(position) = anchor.zotero_position.as_ref() else {
        return Some(anchor);
    };
    let Some(paths) = position.paths.as_ref().filter(|p| !p.is_empty()) else {
        return Some(anchor);
    };
    let kept: Vec<Vec<f64>> = paths
        .iter()
        .filter(|path| !ink_paths_hit_test(std::slice::from_ref(*path), x, y, radius))
        .cloned()
        .collect();
    if kept.len() == paths.len() {
        return Some(anchor);
    }
    if kept.is_empty() {
        return None;
    }
    let trimmed = AnchorZoteroPosition {
        paths: Some(kept),
        ..position.clone()
    };
    Some(AnchorCombinedPdf {
        zotero_position: Some(trimmed),
        ..anchor
    })
}

/// Draft an image region. Returns `None` when either side is below `min_size`. Port of TS
/// `draftImageRegion`.
#[must_use]
pub fn draft_image_region(input: &ImageRegionDraft) -> Option<NewReaderAnnotation> {
    let [x1, y1, x2, y2] = input.rect;
    let min_size = input.min_size.unwrap_or(2.0);
    let width = (x2 - x1).abs();
    let height = (y2 - y1).abs();
    if width < min_size || height < min_size {
        return None;
    }
    let top = input.page_height - js_math::max(y1, y2);
    Some(NewReaderAnnotation {
        kind: "image".to_owned(),
        color: input.color.clone(),
        text: String::new(),
        comment: None,
        tags: Vec::new(),
        page_index: input.page_index,
        anchor: AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(input.page_index),
                rects: Some(vec![vec![
                    js_math::min(x1, x2),
                    js_math::min(y1, y2),
                    js_math::max(x1, x2),
                    js_math::max(y1, y2),
                ]]),
                ..AnchorZoteroPosition::default()
            }),
            ..AnchorCombinedPdf::default()
        },
        sort_index: build_annotation_sort_index(input.page_index, 0.0, top),
    })
}

/// A text box's rect once its words need `height` PDF points: it grows down, keeping its top
/// edge where it was drawn, and never shrinks below that. Port of TS `grownTextRect`.
#[must_use]
pub fn grown_text_rect(rect: [f64; 4], height: f64) -> [f64; 4] {
    let [x0, y0, x1, y1] = rect;
    if height > y1 - y0 {
        [x0, y1 - height, x1, y1]
    } else {
        rect
    }
}

/// A PDF rect as the bottom-left corner and size a draft takes. Port of TS `textBoxFromRect`.
#[must_use]
pub fn text_box_from_rect(rect: [f64; 4]) -> TextBoxRect {
    let [x0, y0, x1, y1] = rect;
    TextBoxRect {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
    }
}

/// Draft a text box. Port of TS `draftTextBox`.
#[must_use]
pub fn draft_text_box(input: &TextBoxDraft) -> NewReaderAnnotation {
    let w = input.width.unwrap_or(120.0);
    let h = input.height.unwrap_or(24.0);
    let top = input.page_height - (input.y + h);
    NewReaderAnnotation {
        kind: "text".to_owned(),
        color: input.color.clone(),
        text: input.text.clone(),
        comment: None,
        tags: Vec::new(),
        page_index: input.page_index,
        anchor: AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(input.page_index),
                rects: Some(vec![vec![input.x, input.y, input.x + w, input.y + h]]),
                ..AnchorZoteroPosition::default()
            }),
            locus: Some(AnchorPdfLocus {
                quote: AnchorQuoteSelector {
                    kind: Some("TextQuoteSelector".to_owned()),
                    exact: Some(input.text.clone()),
                    ..AnchorQuoteSelector::default()
                },
                ..AnchorPdfLocus::default()
            }),
            ..AnchorCombinedPdf::default()
        },
        sort_index: build_annotation_sort_index(input.page_index, 0.0, top),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(text: &str, x: f64, y: f64, w: f64, h: f64) -> SelectionPageTextItem {
        SelectionPageTextItem {
            str: text.to_owned(),
            transform: vec![1.0, 0.0, 0.0, 1.0, x, y],
            width: Some(w),
            height: Some(h),
            has_eol: None,
            font_name: None,
        }
    }

    fn page() -> TextSelectionPage {
        TextSelectionPage {
            page_index: 2.0,
            page_height: 800.0,
            items: vec![
                item("Hello ", 50.0, 700.0, 40.0, 12.0),
                item("world", 90.0, 700.0, 35.0, 12.0),
            ],
            content_hash: None,
        }
    }

    fn selection(end_item: f64, end_offset: f64) -> SelectionTextRange {
        SelectionTextRange {
            start_item_index: 0.0,
            start_offset: 0.0,
            end_item_index: end_item,
            end_offset,
        }
    }

    fn sel_draft(kind: &str) -> TextSelectionDraft {
        TextSelectionDraft {
            kind: kind.to_owned(),
            color: "#ffd400".to_owned(),
            selection: selection(1.0, 5.0),
            page: page(),
            comment: None,
            exact_rects: None,
            next_page_rects: None,
            full_text: None,
        }
    }

    fn ink(path: Vec<f64>) -> InkDraft {
        InkDraft {
            color: "#000".to_owned(),
            page_index: 0.0,
            page_height: 800.0,
            path,
            width: None,
        }
    }

    fn rects_of(anchor: &AnchorCombinedPdf) -> Option<Vec<Vec<f64>>> {
        anchor
            .zotero_position
            .as_ref()
            .and_then(|p| p.rects.clone())
    }

    fn paths_of(anchor: &AnchorCombinedPdf) -> Option<Vec<Vec<f64>>> {
        anchor
            .zotero_position
            .as_ref()
            .and_then(|p| p.paths.clone())
    }

    #[test]
    fn text_selection_builds_highlight_with_zotero_sort_index() {
        let draft = draft_from_text_selection(&sel_draft("highlight")).expect("draft");
        assert_eq!(draft.kind, "highlight");
        assert_eq!(draft.text, "Hello world");
        assert_eq!(draft.page_index, 2.0);
        assert!(draft.sort_index.starts_with("00002|"));
        assert!(rects_of(&draft.anchor).is_some_and(|r| !r.is_empty()));
        assert_eq!(
            draft
                .anchor
                .locus
                .as_ref()
                .and_then(|l| l.quote.exact.clone())
                .as_deref(),
            Some("Hello world")
        );
    }

    #[test]
    fn text_selection_returns_none_for_empty_selection() {
        let mut draft = sel_draft("underline");
        draft.selection = SelectionTextRange {
            start_item_index: 0.0,
            start_offset: 1.0,
            end_item_index: 0.0,
            end_offset: 1.0,
        };
        assert!(draft_from_text_selection(&draft).is_none());
    }

    #[test]
    fn text_selection_preserves_exact_rects_when_provided() {
        let exact = vec![vec![50.0, 698.0, 125.0, 712.0]];
        let mut draft = sel_draft("highlight");
        draft.exact_rects = Some(exact.clone());
        let got = draft_from_text_selection(&draft).expect("draft");
        assert_eq!(rects_of(&got.anchor), Some(exact));
    }

    #[test]
    fn text_selection_supports_cross_page_highlights_with_next_page_rects_and_full_text() {
        let exact = vec![vec![50.0, 698.0, 125.0, 712.0]];
        let next = vec![vec![40.0, 750.0, 200.0, 765.0]];
        let mut draft = sel_draft("highlight");
        draft.exact_rects = Some(exact.clone());
        draft.next_page_rects = Some(next.clone());
        draft.full_text = Some("Hello world spanning onto next page".to_owned());
        let got = draft_from_text_selection(&draft).expect("draft");
        assert_eq!(rects_of(&got.anchor), Some(exact));
        assert_eq!(
            got.anchor
                .zotero_position
                .as_ref()
                .and_then(|p| p.next_page_rects.clone()),
            Some(next)
        );
        assert_eq!(got.text, "Hello world spanning onto next page");
        assert_eq!(
            got.anchor
                .locus
                .as_ref()
                .and_then(|l| l.quote.exact.clone())
                .as_deref(),
            Some("Hello world spanning onto next page")
        );
    }

    #[test]
    fn ink_draft_stores_paths_minus_the_points_the_shape_implies() {
        let draft =
            draft_ink_annotation(&ink(vec![10.0, 20.0, 30.0, 40.0, 50.0, 60.0])).expect("draft");
        assert_eq!(draft.kind, "ink");
        assert_eq!(
            paths_of(&draft.anchor),
            Some(vec![vec![10.0, 20.0, 50.0, 60.0]])
        );
        assert_eq!(
            draft.anchor.zotero_position.as_ref().and_then(|p| p.width),
            Some(2.0),
            "a nib width is always stored"
        );
    }

    #[test]
    fn ink_draft_keeps_a_curve_shape_while_shrinking_it() {
        let mut raw = Vec::new();
        for i in 0..500 {
            let i = f64::from(i);
            raw.push(i * 0.4);
            raw.push(400.0 + (i / 7.0).sin() * 5.0);
        }
        let draft = draft_ink_annotation(&ink(raw.clone())).expect("draft");
        let stored = &paths_of(&draft.anchor).expect("paths")[0];
        assert!(stored.len() >= 4);
        assert!(
            (stored.len() as f64) < raw.len() as f64 / 3.0,
            "stored {} of {} points, compaction did not run",
            stored.len() / 2,
            raw.len() / 2
        );
        assert_eq!(
            stored[0], raw[0],
            "the stroke still starts where the pen touched down"
        );
    }

    #[test]
    fn ink_draft_carries_the_nib_width_a_highlighter_needs() {
        let mut d = ink(vec![10.0, 20.0, 90.0, 20.0]);
        d.width = Some(14.0);
        let draft = draft_ink_annotation(&d).expect("draft");
        assert_eq!(
            draft.anchor.zotero_position.as_ref().and_then(|p| p.width),
            Some(14.0)
        );
    }

    #[test]
    fn append_ink_stroke_keeps_one_mark_in_one_row() {
        let first = draft_ink_annotation(&ink(vec![10.0, 20.0, 90.0, 20.0])).expect("draft");
        let merged = append_ink_stroke(&first.anchor, &[10.0, 40.0, 90.0, 40.0]).expect("merged");
        assert_eq!(paths_of(&merged).map(|p| p.len()), Some(2));
        assert_eq!(
            merged.zotero_position.as_ref().and_then(|p| p.width),
            first.anchor.zotero_position.as_ref().and_then(|p| p.width)
        );
        assert!(
            append_ink_stroke(&first.anchor, &[1.0, 1.0]).is_none(),
            "a stroke too short to draw is not worth a write"
        );
    }

    #[test]
    // The cap is a small whole number, so the cast is exact.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn append_ink_stroke_refuses_to_grow_one_row_without_bound() {
        let full = AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(0.0),
                paths: Some(vec![
                    vec![0.0, 0.0, 10.0, 10.0];
                    INK_MAX_PATHS_PER_ANNOTATION as usize
                ]),
                width: Some(2.0),
                ..AnchorZoteroPosition::default()
            }),
            ..AnchorCombinedPdf::default()
        };
        assert!(
            append_ink_stroke(&full, &[20.0, 20.0, 30.0, 30.0]).is_none(),
            "a full annotation must send the next stroke to a new row"
        );
    }

    #[test]
    fn ink_draft_rejects_short_paths() {
        assert!(draft_ink_annotation(&ink(vec![1.0, 2.0])).is_none());
    }

    #[test]
    fn image_region_stores_a_single_rect() {
        let draft = draft_image_region(&ImageRegionDraft {
            color: "#aaaaaa".to_owned(),
            page_index: 1.0,
            page_height: 800.0,
            rect: [10.0, 20.0, 110.0, 120.0],
            min_size: None,
        })
        .expect("draft");
        assert_eq!(draft.kind, "image");
        assert_eq!(
            rects_of(&draft.anchor),
            Some(vec![vec![10.0, 20.0, 110.0, 120.0]])
        );
    }

    #[test]
    fn image_region_rejects_tiny_clicks() {
        assert!(
            draft_image_region(&ImageRegionDraft {
                color: "#aaaaaa".to_owned(),
                page_index: 0.0,
                page_height: 800.0,
                rect: [10.0, 20.0, 10.5, 20.5],
                min_size: None,
            })
            .is_none()
        );
    }

    fn text_box(
        text: &str,
        page_index: f64,
        width: Option<f64>,
        height: Option<f64>,
    ) -> TextBoxDraft {
        TextBoxDraft {
            color: "#5fb236".to_owned(),
            page_index,
            page_height: 800.0,
            text: text.to_owned(),
            x: 40.0,
            y: 100.0,
            width,
            height,
        }
    }

    #[test]
    fn text_box_stores_typed_text_and_rect() {
        let draft = draft_text_box(&text_box("Margin note", 0.0, None, None));
        assert_eq!(draft.kind, "text");
        assert_eq!(draft.text, "Margin note");
        assert_eq!(
            draft
                .anchor
                .locus
                .as_ref()
                .and_then(|l| l.quote.exact.clone())
                .as_deref(),
            Some("Margin note")
        );
    }

    #[test]
    fn text_box_sizes_the_rect_from_a_dragged_width_height() {
        let draft = draft_text_box(&text_box("Sized note", 2.0, Some(220.0), Some(60.0)));
        assert_eq!(
            rects_of(&draft.anchor),
            Some(vec![vec![40.0, 100.0, 260.0, 160.0]])
        );
    }

    #[test]
    fn text_box_falls_back_to_a_default_rect_when_no_size_is_given() {
        let draft = draft_text_box(&text_box("Tapped note", 0.0, None, None));
        assert_eq!(
            rects_of(&draft.anchor),
            Some(vec![vec![40.0, 100.0, 160.0, 124.0]])
        );
    }

    #[test]
    fn erase_takes_only_the_stroke_it_touches_from_a_grouped_ink_annotation() {
        let anchor = AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(0.0),
                width: Some(2.0),
                paths: Some(vec![
                    vec![0.0, 0.0, 100.0, 0.0],
                    vec![0.0, 50.0, 100.0, 50.0],
                    vec![0.0, 100.0, 100.0, 100.0],
                ]),
                ..AnchorZoteroPosition::default()
            }),
            ..AnchorCombinedPdf::default()
        };
        let trimmed = erase_ink_paths(anchor.clone(), 50.0, 52.0, 4.0).expect("some remain");
        assert_eq!(
            paths_of(&trimmed),
            Some(vec![
                vec![0.0, 0.0, 100.0, 0.0],
                vec![0.0, 100.0, 100.0, 100.0]
            ])
        );
        assert_eq!(
            erase_ink_paths(anchor.clone(), 50.0, 25.0, 4.0),
            Some(anchor),
            "a miss returns the same anchor"
        );
        let one = AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(0.0),
                paths: Some(vec![vec![0.0, 0.0, 100.0, 0.0]]),
                ..AnchorZoteroPosition::default()
            }),
            ..AnchorCombinedPdf::default()
        };
        assert!(
            erase_ink_paths(one, 50.0, 1.0, 4.0).is_none(),
            "erasing the last stroke removes the annotation"
        );
    }
}

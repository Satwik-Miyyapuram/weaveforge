//! Project stored annotation geometry onto one rendered page (`reader::annotation_geometry`).
//! Port of `apps/web/src/features/reader/application/project-annotation-geometry.ts`.
//!
//! Stored anchors are PDF user space with a bottom-left origin. This module flips them to the
//! DOM's top-left CSS pixels, scales them, and groups annotations by the page they paint on.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::anchor::{AnchorStrategy, choose_anchor_strategy};
use super::annotation_helpers::ReaderAnnotation;
use super::highlight_rects::normalize_highlight_rects;
use super::ink_stroke::{INK_DEFAULT_WIDTH, is_highlighter_ink};
use super::picture::picture_path;
use super::viewport::{ReaderPageProjection, pdf_point_to_screen, pdf_rect_to_screen_box};
use crate::ink::js_math;

/// A rectangle drawn on the page, in CSS pixels (TS `AnnotationBox`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnnotationBox {
    /// Stable annotation id.
    pub id: String,
    /// Distance from the page's left edge, in CSS pixels.
    pub left: f64,
    /// Distance from the page's top edge, in CSS pixels.
    pub top: f64,
    /// Box width in CSS pixels.
    pub width: f64,
    /// Box height in CSS pixels.
    pub height: f64,
    /// Border or fill colour as a CSS colour string.
    pub color: String,
    /// Whether the box is drawn underlined.
    pub underline: bool,
    /// The stored file of a placed picture, drawn in the box.
    pub picture: Option<String>,
    /// A text box's words, drawn in the box; `None` for every other mark.
    pub text: Option<String>,
}

/// A polyline of ink, as flat `x, y` pairs in CSS pixels (TS `AnnotationStroke`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnnotationStroke {
    /// Stable annotation id.
    pub id: String,
    /// Stroke colour as a CSS colour string.
    pub color: String,
    /// Flat `x, y` pairs in CSS pixels.
    pub points: Vec<f64>,
    /// Nib width in CSS pixels.
    pub width: f64,
    /// Wide strokes are highlighter marks: translucent, laid over the text.
    pub highlighter: bool,
}

/// Everything one page paints from the annotation list (TS `PageAnnotationGeometry`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PageAnnotationGeometry {
    /// Boxes to paint on this page.
    pub boxes: Vec<AnnotationBox>,
    /// Ink strokes to paint on this page.
    pub strokes: Vec<AnnotationStroke>,
}

/// Input to [`project_page_annotation_geometry`] (TS `ProjectGeometryInput`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProjectGeometryInput {
    /// Annotations to project onto the page.
    pub annotations: Vec<ReaderAnnotation>,
    /// 1-based page currently being painted.
    pub page_number: f64,
    /// CSS pixels per PDF user-space unit.
    pub scale: f64,
    /// Unrotated page height in PDF user-space units.
    pub page_height: f64,
    /// Unrotated page width in PDF user-space units.
    pub page_width: f64,
    /// Page rotation in degrees: 0, 90, 180 or 270.
    pub rotation: f64,
    /// Hash of the PDF on screen; empty means unknown.
    pub content_hash: String,
}

/// One page's share of the annotation list: positions in the input list, in input order.
/// The buckets come back in first-insertion order, matching the TS `Map`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PageBucket {
    /// 1-based page the annotations paint on.
    pub page_number: f64,
    /// Indices into the input slice. `u32` keeps the type JS-safe.
    pub annotation_indices: Vec<u32>,
}

/// `Number.isInteger(x) && x >= 0`, returned as the page index when it holds.
fn placeable_page_index(value: Option<f64>) -> Option<f64> {
    value.filter(|i| i.is_finite() && i.trunc() == *i && *i >= 0.0)
}

fn add_to_bucket(
    buckets: &mut Vec<PageBucket>,
    slot: &mut HashMap<u64, usize>,
    page_number: f64,
    index: u32,
) {
    // Page numbers are integers >= 1, so the bit pattern is an exact key.
    let key = page_number.to_bits();
    if let Some(&at) = slot.get(&key) {
        buckets[at].annotation_indices.push(index);
    } else {
        let _ = slot.insert(key, buckets.len());
        buckets.push(PageBucket {
            page_number,
            annotation_indices: vec![index],
        });
    }
}

/// Group annotations by the 1-based page they paint on, so each page scans only its own.
///
/// A highlight that crosses a page break paints on two pages, so it appears in both buckets.
/// Annotations with no stored position appear in none.
#[must_use]
pub fn bucket_annotations_by_page(annotations: &[ReaderAnnotation]) -> Vec<PageBucket> {
    let mut buckets: Vec<PageBucket> = Vec::new();
    let mut slot: HashMap<u64, usize> = HashMap::new();
    for (index, ann) in annotations.iter().enumerate() {
        let Some(position) = ann.anchor.zotero_position.as_ref() else {
            continue;
        };
        let Some(page_index) = placeable_page_index(position.page_index) else {
            continue;
        };
        // Input lists are far below 2^32 entries, so the cast is exact.
        #[allow(clippy::cast_possible_truncation)]
        let index = index as u32;
        add_to_bucket(&mut buckets, &mut slot, page_index + 1.0, index);
        if position
            .next_page_rects
            .as_ref()
            .is_some_and(|rects| !rects.is_empty())
        {
            add_to_bucket(&mut buckets, &mut slot, page_index + 2.0, index);
        }
    }
    buckets
}

/// `isRect`: at least four numbers, all finite.
fn is_rect(value: &[f64]) -> bool {
    value.len() >= 4 && value[..4].iter().all(|n| n.is_finite())
}

/// Project every annotation that paints on `input.page_number` into CSS pixels.
///
/// Geometry only paints when the anchor's stored file matches the one on screen
/// (`choose_anchor_strategy` returns `Rects`). A highlight whose tail spills from the
/// previous page is drawn from `next_page_rects` on the following page.
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn project_page_annotation_geometry(input: &ProjectGeometryInput) -> PageAnnotationGeometry {
    let page_index = input.page_number - 1.0;
    let projection = ReaderPageProjection {
        page_width: input.page_width,
        page_height: input.page_height,
        scale: input.scale,
        rotation: input.rotation,
    };
    let mut geometry = PageAnnotationGeometry::default();

    for ann in &input.annotations {
        let Some(position) = ann.anchor.zotero_position.as_ref() else {
            continue;
        };
        // Stored geometry only means anything against the file it was captured on.
        if !matches!(
            choose_anchor_strategy(&ann.anchor, &input.content_hash),
            AnchorStrategy::Rects { .. }
        ) {
            continue;
        }
        let picture = picture_path(&ann.kind, ann.comment.as_deref());

        if position.page_index == Some(page_index)
            && position
                .paths
                .as_ref()
                .is_some_and(|paths| !paths.is_empty())
        {
            let ink_width = position.width.unwrap_or(INK_DEFAULT_WIDTH);
            let highlighter = is_highlighter_ink(position.width);
            for path in position.paths.iter().flatten() {
                if path.len() < 4 {
                    continue;
                }
                let mut points: Vec<f64> = Vec::new();
                // Pairs only: a trailing odd value is ignored, as in the TS loop.
                for pair in path.as_chunks::<2>().0 {
                    let (x, y) = (pair[0], pair[1]);
                    if !x.is_finite() || !y.is_finite() {
                        continue;
                    }
                    let screen = pdf_point_to_screen(x, y, projection);
                    points.push(screen.x);
                    points.push(screen.y);
                }
                if points.len() >= 4 {
                    geometry.strokes.push(AnnotationStroke {
                        id: ann.id.clone(),
                        color: ann.color.clone(),
                        points,
                        // The nib zooms with the page and keeps a floor of 0.5 CSS px.
                        width: js_math::max(ink_width * input.scale, 0.5),
                        highlighter,
                    });
                }
            }
        }

        let mut rect_sets: Vec<&Vec<Vec<f64>>> = Vec::new();
        if position.page_index == Some(page_index)
            && let Some(rects) = position.rects.as_ref().filter(|rects| !rects.is_empty())
        {
            rect_sets.push(rects);
        }
        // A highlight that began on the previous page spills its tail onto this one.
        if position
            .page_index
            .is_some_and(|index| index + 1.0 == page_index)
            && let Some(rects) = position
                .next_page_rects
                .as_ref()
                .filter(|rects| !rects.is_empty())
        {
            rect_sets.push(rects);
        }

        // Text marks are stored as the selection's raw, overlapping span boxes; painted as-is
        // every overlap shows twice as dark. Regions and notes are single boxes, left alone.
        let text_mark = ann.kind == "highlight" || ann.kind == "underline";
        for stored in rect_sets {
            let rects: Vec<Vec<f64>> = if text_mark {
                let valid: Vec<Vec<f64>> = stored
                    .iter()
                    .filter(|rect| is_rect(rect))
                    .cloned()
                    .collect();
                normalize_highlight_rects(&valid)
            } else {
                stored.clone()
            };
            for rect in rects {
                if !is_rect(&rect) {
                    continue;
                }
                let box_ = pdf_rect_to_screen_box([rect[0], rect[1], rect[2], rect[3]], projection);
                geometry.boxes.push(AnnotationBox {
                    id: ann.id.clone(),
                    left: box_.left,
                    top: box_.top,
                    width: box_.width,
                    height: box_.height,
                    color: ann.color.clone(),
                    underline: ann.kind == "underline",
                    picture: picture.clone(),
                    text: (ann.kind == "text").then(|| ann.text.clone()),
                });
            }
        }
    }

    geometry
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::anchor::{
        AnchorCombinedPdf, AnchorPdfLocus, AnchorQuoteSelector, AnchorZoteroPosition,
    };

    const PAGE_HEIGHT: f64 = 792.0;
    const PAGE_WIDTH: f64 = 612.0;

    fn mark(id: &str, kind: &str, anchor: AnchorCombinedPdf) -> ReaderAnnotation {
        ReaderAnnotation {
            id: id.to_owned(),
            origin: "zotero".to_owned(),
            zotero_key: Some("ABCD1234".to_owned()),
            kind: kind.to_owned(),
            color: "#ffd400".to_owned(),
            text: "quoted".to_owned(),
            comment: Some(String::new()),
            anchor,
            sort_index: "00000|000000|00000".to_owned(),
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            updated_at: "2026-01-01T00:00:00.000Z".to_owned(),
            ..Default::default()
        }
    }

    fn hl(id: &str, anchor: AnchorCombinedPdf) -> ReaderAnnotation {
        mark(id, "highlight", anchor)
    }

    fn rect_anchor(page_index: f64, rects: Vec<Vec<f64>>) -> AnchorCombinedPdf {
        AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(page_index),
                rects: Some(rects),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn ink_anchor(page_index: f64, paths: Vec<Vec<f64>>, width: Option<f64>) -> AnchorCombinedPdf {
        AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(page_index),
                paths: Some(paths),
                width,
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn input(annotations: Vec<ReaderAnnotation>, page_number: f64) -> ProjectGeometryInput {
        ProjectGeometryInput {
            annotations,
            page_number,
            scale: 1.0,
            page_height: PAGE_HEIGHT,
            page_width: PAGE_WIDTH,
            rotation: 0.0,
            content_hash: String::new(),
        }
    }

    fn project(annotations: Vec<ReaderAnnotation>, page_number: f64) -> PageAnnotationGeometry {
        project_page_annotation_geometry(&input(annotations, page_number))
    }

    fn box_xywh(b: &AnnotationBox) -> (f64, f64, f64, f64) {
        (b.left, b.top, b.width, b.height)
    }

    #[test]
    fn flips_the_pdf_bottom_left_origin_to_a_dom_top_left_origin() {
        // A rect 700..712 units up from the bottom of a 792-unit page sits 80px from the top.
        let geometry = project(
            vec![hl(
                "a1",
                rect_anchor(0.0, vec![vec![72.0, 700.0, 172.0, 712.0]]),
            )],
            1.0,
        );
        assert_eq!(geometry.boxes.len(), 1);
        assert_eq!(box_xywh(&geometry.boxes[0]), (72.0, 80.0, 100.0, 12.0));
    }

    #[test]
    fn scales_every_projected_dimension() {
        let mut scaled = input(
            vec![hl(
                "a1",
                rect_anchor(0.0, vec![vec![72.0, 700.0, 172.0, 712.0]]),
            )],
            1.0,
        );
        scaled.scale = 2.0;
        let geometry = project_page_annotation_geometry(&scaled);
        assert_eq!(box_xywh(&geometry.boxes[0]), (144.0, 160.0, 200.0, 24.0));
    }

    #[test]
    fn normalises_rects_stored_with_inverted_corners() {
        let geometry = project(
            vec![hl(
                "a1",
                rect_anchor(0.0, vec![vec![172.0, 712.0, 72.0, 700.0]]),
            )],
            1.0,
        );
        assert_eq!(box_xywh(&geometry.boxes[0]), (72.0, 80.0, 100.0, 12.0));
    }

    #[test]
    fn only_paints_rects_belonging_to_the_page_being_rendered() {
        let annotations = vec![
            hl("p0", rect_anchor(0.0, vec![vec![0.0, 0.0, 10.0, 10.0]])),
            hl("p4", rect_anchor(4.0, vec![vec![0.0, 0.0, 10.0, 10.0]])),
        ];
        let ids = |page: f64| -> Vec<String> {
            project(annotations.clone(), page)
                .boxes
                .into_iter()
                .map(|b| b.id)
                .collect()
        };
        assert_eq!(ids(1.0), vec!["p0".to_owned()]);
        assert_eq!(ids(5.0), vec!["p4".to_owned()]);
    }

    #[test]
    fn paints_next_page_rects_on_the_following_page_only() {
        // Anchored to page index 3, tail spilling onto page index 4.
        let spilling = hl(
            "spill",
            AnchorCombinedPdf {
                zotero_position: Some(AnchorZoteroPosition {
                    page_index: Some(3.0),
                    rects: Some(vec![vec![72.0, 100.0, 500.0, 112.0]]),
                    next_page_rects: Some(vec![vec![72.0, 700.0, 300.0, 712.0]]),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );

        // Page 4 (index 3) gets the head only.
        let head = project(vec![spilling.clone()], 4.0).boxes;
        assert_eq!(head.len(), 1);
        assert_eq!(head[0].top, PAGE_HEIGHT - 112.0);

        // Page 5 (index 4) gets the tail only.
        let tail = project(vec![spilling.clone()], 5.0).boxes;
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0].top, PAGE_HEIGHT - 712.0);
        assert_eq!(tail[0].width, 228.0);

        // Nothing leaks onto an unrelated page.
        assert!(project(vec![spilling], 6.0).boxes.is_empty());
    }

    #[test]
    fn projects_ink_paths_as_scaled_flipped_polyline_points() {
        let geometry = project(
            vec![mark(
                "ink",
                "ink",
                ink_anchor(0.0, vec![vec![10.0, 782.0, 20.0, 772.0]], None),
            )],
            1.0,
        );
        assert!(geometry.boxes.is_empty(), "ink has no rects to box");
        assert_eq!(geometry.strokes.len(), 1);
        assert_eq!(geometry.strokes[0].points, vec![10.0, 10.0, 20.0, 20.0]);
    }

    #[test]
    fn ink_carries_its_nib_width_scaled_with_the_page() {
        let ink = mark(
            "ink",
            "ink",
            ink_anchor(0.0, vec![vec![10.0, 782.0, 20.0, 772.0]], Some(3.0)),
        );
        assert_eq!(project(vec![ink.clone()], 1.0).strokes[0].width, 3.0);
        let mut zoomed = input(vec![ink], 1.0);
        zoomed.scale = 2.0;
        assert_eq!(
            project_page_annotation_geometry(&zoomed).strokes[0].width,
            6.0,
            "the nib is a width on the page, so it zooms with it"
        );
    }

    #[test]
    fn a_wide_nib_is_a_highlighter_a_narrow_one_is_a_pen() {
        let stroke = |width: Option<f64>| {
            project(
                vec![mark(
                    "ink",
                    "ink",
                    ink_anchor(0.0, vec![vec![10.0, 700.0, 200.0, 700.0]], width),
                )],
                1.0,
            )
            .strokes[0]
                .clone()
        };
        assert!(!stroke(Some(2.0)).highlighter);
        assert!(stroke(Some(14.0)).highlighter);
        assert!(
            !stroke(None).highlighter,
            "ink stored before widths existed stays a pen"
        );
        assert_eq!(
            stroke(None).width,
            2.0,
            "and gets the default nib rather than a zero-width line"
        );
    }

    #[test]
    fn rotation_moves_annotations_with_the_page_instead_of_stranding_them() {
        let highlight = hl(
            "a1",
            rect_anchor(0.0, vec![vec![72.0, 700.0, 172.0, 712.0]]),
        );

        let upright = project(vec![highlight.clone()], 1.0).boxes[0].clone();
        assert_eq!((upright.left, upright.top), (72.0, 80.0));

        // At 90 degrees the highlight's PDF y becomes its screen x.
        let mut quarter_input = input(vec![highlight.clone()], 1.0);
        quarter_input.rotation = 90.0;
        let quarter = project_page_annotation_geometry(&quarter_input).boxes[0].clone();
        assert_eq!(box_xywh(&quarter), (700.0, 72.0, 12.0, 100.0));

        let mut half_input = input(vec![highlight], 1.0);
        half_input.rotation = 180.0;
        let half = project_page_annotation_geometry(&half_input).boxes[0].clone();
        assert_eq!(box_xywh(&half), (PAGE_WIDTH - 172.0, 700.0, 100.0, 12.0));
    }

    #[test]
    fn ink_follows_the_same_rotation_as_the_rest_of_the_page() {
        let ink = mark(
            "ink",
            "ink",
            ink_anchor(0.0, vec![vec![10.0, 782.0, 20.0, 772.0]], None),
        );
        let mut rotated = input(vec![ink], 1.0);
        rotated.rotation = 90.0;
        assert_eq!(
            project_page_annotation_geometry(&rotated).strokes[0].points,
            vec![782.0, 10.0, 772.0, 20.0]
        );
    }

    #[test]
    fn drops_malformed_rects_and_path_points_instead_of_emitting_nan_geometry() {
        let bad = hl(
            "bad",
            AnchorCombinedPdf {
                zotero_position: Some(AnchorZoteroPosition {
                    page_index: Some(0.0),
                    rects: Some(vec![
                        vec![1.0, 2.0],
                        vec![f64::NAN, 1.0, 2.0, 3.0],
                        vec![72.0, 700.0, 172.0, 712.0],
                    ]),
                    paths: Some(vec![vec![1.0, 2.0]]),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );
        let geometry = project(vec![bad], 1.0);
        assert_eq!(
            geometry.boxes.len(),
            1,
            "only the well-formed rect survives"
        );
        assert!(
            geometry.strokes.is_empty(),
            "a two-number path is not a stroke"
        );
        for b in &geometry.boxes {
            for n in [b.left, b.top, b.width, b.height] {
                assert!(n.is_finite(), "no NaN reaches a style attribute");
            }
        }
    }

    fn stale_anchor(content_hash: &str) -> AnchorCombinedPdf {
        AnchorCombinedPdf {
            content_hash: Some(content_hash.to_owned()),
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(0.0),
                rects: Some(vec![vec![72.0, 700.0, 172.0, 712.0]]),
                ..Default::default()
            }),
            locus: Some(AnchorPdfLocus {
                quote: AnchorQuoteSelector {
                    kind: Some("TextQuoteSelector".to_owned()),
                    exact: Some("quoted".to_owned()),
                    ..Default::default()
                },
                position: None,
            }),
        }
    }

    #[test]
    fn refuses_to_paint_geometry_captured_against_a_different_file() {
        let stale = hl("a1", stale_anchor("hash-of-the-old-pdf"));
        let mut new_file = input(vec![stale.clone()], 1.0);
        new_file.content_hash = "hash-of-the-new-pdf".to_owned();
        assert!(project_page_annotation_geometry(&new_file).boxes.is_empty());

        let mut old_file = input(vec![stale], 1.0);
        old_file.content_hash = "hash-of-the-old-pdf".to_owned();
        assert_eq!(project_page_annotation_geometry(&old_file).boxes.len(), 1);
    }

    #[test]
    fn refuses_to_paint_ink_captured_against_a_different_file() {
        // Ink has no quote to fall back to, so an ungated path would be drawn at coordinates
        // that mean nothing in the current document.
        let stale = AnchorCombinedPdf {
            content_hash: Some("old".to_owned()),
            ..ink_anchor(0.0, vec![vec![10.0, 782.0, 20.0, 772.0]], None)
        };
        let ink = mark("ink", "ink", stale);
        let mut new_file = input(vec![ink.clone()], 1.0);
        new_file.content_hash = "new".to_owned();
        assert!(
            project_page_annotation_geometry(&new_file)
                .strokes
                .is_empty()
        );

        let mut old_file = input(vec![ink], 1.0);
        old_file.content_hash = "old".to_owned();
        assert_eq!(project_page_annotation_geometry(&old_file).strokes.len(), 1);
    }

    #[test]
    fn trusts_geometry_when_neither_side_names_a_file() {
        // Local annotations on a PDF with no hash: the common case today.
        let local = ReaderAnnotation {
            origin: "local".to_owned(),
            zotero_key: None,
            ..mark(
                "a1",
                "highlight",
                rect_anchor(0.0, vec![vec![72.0, 700.0, 172.0, 712.0]]),
            )
        };
        assert_eq!(project(vec![local], 1.0).boxes.len(), 1);
    }

    #[test]
    fn marks_underlines_so_they_render_as_a_rule_rather_than_a_fill() {
        let geometry = project(
            vec![
                mark(
                    "u",
                    "underline",
                    rect_anchor(0.0, vec![vec![0.0, 0.0, 10.0, 10.0]]),
                ),
                hl("h", rect_anchor(0.0, vec![vec![0.0, 0.0, 10.0, 10.0]])),
            ],
            1.0,
        );
        let underlines: Vec<bool> = geometry.boxes.iter().map(|b| b.underline).collect();
        assert_eq!(underlines, vec![true, false]);
    }

    #[test]
    fn skips_annotations_with_no_stored_position() {
        let quote_only = hl(
            "a1",
            AnchorCombinedPdf {
                locus: Some(AnchorPdfLocus {
                    quote: AnchorQuoteSelector {
                        kind: Some("TextQuoteSelector".to_owned()),
                        exact: Some("somewhere".to_owned()),
                        ..Default::default()
                    },
                    position: None,
                }),
                ..Default::default()
            },
        );
        assert_eq!(
            project(vec![quote_only], 1.0),
            PageAnnotationGeometry::default()
        );
    }

    fn bucket_for(buckets: &[PageBucket], page_number: f64) -> Option<&PageBucket> {
        buckets
            .iter()
            .find(|bucket| bucket.page_number == page_number)
    }

    #[test]
    fn bucket_annotations_by_page_groups_by_the_page_an_annotation_paints_on() {
        let first = hl("p1", rect_anchor(0.0, vec![vec![0.0, 0.0, 1.0, 1.0]]));
        let later = hl("p5", rect_anchor(4.0, vec![vec![0.0, 0.0, 1.0, 1.0]]));
        let annotations = vec![first, later];
        let buckets = bucket_annotations_by_page(&annotations);
        assert_eq!(
            bucket_for(&buckets, 1.0).map(|b| b.annotation_indices.clone()),
            Some(vec![0])
        );
        assert_eq!(
            bucket_for(&buckets, 5.0).map(|b| b.annotation_indices.clone()),
            Some(vec![1])
        );
        assert!(bucket_for(&buckets, 2.0).is_none());
        assert_eq!(buckets.len(), 2);
    }

    #[test]
    fn bucket_annotations_by_page_puts_a_cross_page_highlight_in_both_buckets() {
        // Anchored to page index 3, spilling onto index 4: pages 4 and 5.
        let spilling = hl(
            "spill",
            AnchorCombinedPdf {
                zotero_position: Some(AnchorZoteroPosition {
                    page_index: Some(3.0),
                    rects: Some(vec![vec![72.0, 100.0, 500.0, 112.0]]),
                    next_page_rects: Some(vec![vec![72.0, 700.0, 300.0, 712.0]]),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );
        let buckets = bucket_annotations_by_page(&[spilling]);
        assert_eq!(
            bucket_for(&buckets, 4.0).map(|b| b.annotation_indices.clone()),
            Some(vec![0])
        );
        assert_eq!(
            bucket_for(&buckets, 5.0).map(|b| b.annotation_indices.clone()),
            Some(vec![0])
        );
        assert_eq!(buckets.len(), 2);
    }

    #[test]
    fn bucket_annotations_by_page_drops_annotations_that_cannot_be_placed() {
        let quote_only = hl("q", AnchorCombinedPdf::default());
        let negative = hl(
            "n",
            AnchorCombinedPdf {
                zotero_position: Some(AnchorZoteroPosition {
                    page_index: Some(-1.0),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );
        let fractional = hl(
            "f",
            AnchorCombinedPdf {
                zotero_position: Some(AnchorZoteroPosition {
                    page_index: Some(1.5),
                    ..Default::default()
                }),
                ..Default::default()
            },
        );
        assert!(bucket_annotations_by_page(&[quote_only, negative, fractional]).is_empty());
    }

    #[test]
    fn bucketing_and_projection_agree_on_which_page_paints_what() {
        // The bucket is a filter in front of the projector; if they disagree an annotation
        // silently stops rendering.
        let annotations = vec![
            hl("a", rect_anchor(0.0, vec![vec![0.0, 0.0, 10.0, 10.0]])),
            hl(
                "b",
                AnchorCombinedPdf {
                    zotero_position: Some(AnchorZoteroPosition {
                        page_index: Some(1.0),
                        rects: Some(vec![vec![0.0, 0.0, 10.0, 10.0]]),
                        next_page_rects: Some(vec![vec![0.0, 0.0, 10.0, 10.0]]),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ),
            mark(
                "c",
                "ink",
                ink_anchor(2.0, vec![vec![1.0, 2.0, 3.0, 4.0]], None),
            ),
        ];
        let buckets = bucket_annotations_by_page(&annotations);
        for page_number in 1..=4 {
            let page = f64::from(page_number);
            let from_all = project(annotations.clone(), page);
            let subset: Vec<ReaderAnnotation> = bucket_for(&buckets, page)
                .map(|bucket| {
                    bucket
                        .annotation_indices
                        .iter()
                        .map(|&i| annotations[i as usize].clone())
                        .collect()
                })
                .unwrap_or_default();
            let from_bucket = project(subset, page);
            assert_eq!(
                from_bucket, from_all,
                "page {page_number} must render identically"
            );
        }
    }
}

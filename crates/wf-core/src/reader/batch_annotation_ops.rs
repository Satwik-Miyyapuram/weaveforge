//! Image-region annotations for bulk extract. A port of
//! `collectAnnotationImageRegions` in
//! `apps/web/src/features/reader/application/parts.ts`. The
//! activity log stays in TS: it reads the clock and a random id.

use serde::{Deserialize, Serialize};

/// The fields of a TS `ReaderAnnotation` that the image-region rule reads.
/// Every other field is ignored on deserialisation.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInput {
    /// Annotation id.
    pub id: String,
    /// Annotation type (`image`, `highlight`, ...), the TS `type` field.
    #[serde(rename = "type")]
    pub kind: String,
    /// Display colour.
    pub color: String,
    /// The anchor; a missing anchor has no Zotero position.
    #[serde(default)]
    pub anchor: AnchorInput,
}

/// The part of a TS `CombinedPdfAnchor` the rule reads.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnchorInput {
    /// Zotero page and rects, when the anchor has them.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub zotero_position: Option<PositionInput>,
}

/// The part of a TS `ZoteroRectPosition` the rule reads.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PositionInput {
    /// Zero-based page index.
    pub page_index: f64,
    /// PDF user-space rects `[x1, y1, x2, y2]`.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub rects: Option<Vec<Vec<f64>>>,
}

/// One rect of an image annotation, ready for bulk extract (rasterised later).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BatchImageRegion {
    /// The annotation the rect belongs to.
    pub annotation_id: String,
    /// Zero-based page index.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub page_index: f64,
    /// The first four numbers of the rect. (`u32` only makes the TS type a
    /// plain `number[]`; the values stay fractional.)
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub rect: Vec<f64>,
    /// The annotation's colour.
    pub color: String,
}

/// Collect image-region annotations for bulk extract, one entry per rect.
/// Only `image` annotations with a Zotero position and at least one rect of
/// four or more numbers count; extra numbers past the fourth are dropped.
#[must_use]
pub fn collect_annotation_image_regions(annotations: &[AnnotationInput]) -> Vec<BatchImageRegion> {
    let mut out = Vec::new();
    for ann in annotations {
        if ann.kind != "image" {
            continue;
        }
        let Some(pos) = &ann.anchor.zotero_position else {
            continue;
        };
        let Some(rects) = &pos.rects else {
            continue;
        };
        for rect in rects {
            if rect.len() < 4 {
                continue;
            }
            out.push(BatchImageRegion {
                annotation_id: ann.id.clone(),
                page_index: pos.page_index,
                rect: rect[..4].to_vec(),
                color: ann.color.clone(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ann(id: &str, kind: &str, page_index: f64, rects: Option<Vec<Vec<f64>>>) -> AnnotationInput {
        AnnotationInput {
            id: id.to_owned(),
            kind: kind.to_owned(),
            color: "#aaaaaa".to_owned(),
            anchor: AnchorInput {
                zotero_position: Some(PositionInput { page_index, rects }),
            },
        }
    }

    #[test]
    fn collects_rects_only_from_image_annotations() {
        let regions = collect_annotation_image_regions(&[
            ann(
                "i1",
                "image",
                2.0,
                Some(vec![vec![1.0, 2.0, 3.0, 4.0], vec![5.0, 6.0, 7.0, 8.0]]),
            ),
            ann("h1", "highlight", 0.0, Some(vec![vec![0.0, 0.0, 1.0, 1.0]])),
        ]);
        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].page_index, 2.0);
        assert_eq!(regions[1].rect, vec![5.0, 6.0, 7.0, 8.0]);
        assert_eq!(regions[1].annotation_id, "i1");
    }

    #[test]
    fn skips_short_rects_missing_positions_and_missing_rects() {
        let regions = collect_annotation_image_regions(&[
            ann("short", "image", 0.0, Some(vec![vec![1.0, 2.0, 3.0]])),
            ann("none", "image", 0.0, None),
            ann("empty", "image", 0.0, Some(Vec::new())),
            AnnotationInput {
                id: "bare".to_owned(),
                kind: "image".to_owned(),
                color: "#000000".to_owned(),
                anchor: AnchorInput::default(),
            },
        ]);
        assert!(regions.is_empty());
    }

    #[test]
    fn keeps_only_the_first_four_numbers_of_a_rect() {
        let regions = collect_annotation_image_regions(&[ann(
            "i",
            "image",
            1.0,
            Some(vec![vec![1.0, 2.0, 3.0, 4.0, 9.0]]),
        )]);
        assert_eq!(regions[0].rect, vec![1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn reads_the_typescript_reader_annotation_shape() {
        let json = r##"[{
            "id": "i1", "origin": "local", "zoteroKey": null, "type": "image",
            "color": "#ff0000", "text": "", "comment": "", "tags": [],
            "anchor": { "zoteroPosition": { "pageIndex": 3, "rects": [[10, 20, 30, 40]] } },
            "sortIndex": "00000|000000|00000",
            "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"
        }]"##;
        let input: Vec<AnnotationInput> = serde_json::from_str(json).expect("TS shape parses");
        let regions = collect_annotation_image_regions(&input);
        assert_eq!(
            regions,
            vec![BatchImageRegion {
                annotation_id: "i1".to_owned(),
                page_index: 3.0,
                rect: vec![10.0, 20.0, 30.0, 40.0],
                color: "#ff0000".to_owned(),
            }]
        );
    }
}

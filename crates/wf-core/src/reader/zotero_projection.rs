//! Project cached Zotero annotations into the single reader-annotation model (TS
//! `reader/application/project-zotero-annotations.ts`). Notes (`kind == "note"`) are dropped:
//! they are not page-anchored.

use serde::{Deserialize, Serialize};

use crate::reader::anchor::{
    AnchorCombinedPdf, AnchorPdfLocus, AnchorQuoteSelector, AnchorZoteroPosition,
};
use crate::reader::annotation::is_reader_annotation_type;
use crate::reader::viewport::build_annotation_sort_index;
use crate::search::js_text::is_js_whitespace;

/// Colour used when a Zotero annotation has none (TS `DEFAULT_ANNOTATION_COLOR`).
pub const DEFAULT_ANNOTATION_COLOR: &str = "#ffd400";

/// `new Date(0).toISOString()`, the timestamp used when the caller gives none.
const EPOCH_ISO: &str = "1970-01-01T00:00:00.000Z";

/// A cached Zotero annotation (TS `ZoteroAnnotation`). Missing fields take the TS `undefined`
/// meaning; older caches may lack `tags`.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroAnnotationInput {
    /// Zotero item key.
    pub key: Option<String>,
    /// `"annotation"` or `"note"`.
    pub kind: Option<String>,
    /// Selected text.
    pub text: Option<String>,
    /// Comment written on the annotation.
    pub comment: Option<String>,
    /// Colour as written by Zotero.
    pub color: Option<String>,
    /// Tags, in Zotero order.
    pub tags: Vec<String>,
    /// Zotero annotation type (`highlight`, `ink`, ...).
    pub annotation_type: Option<String>,
    /// Page geometry.
    pub annotation_position: Option<AnchorZoteroPosition>,
    /// Zotero's ordering key.
    pub annotation_sort_index: Option<String>,
}

/// A Zotero annotation as a reader annotation (TS `ReaderAnnotation` with `origin: "zotero"`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroReaderAnnotation {
    /// Row id: the Zotero key, or `zotero-N` when it has none.
    pub id: String,
    /// Always `"zotero"`.
    pub origin: String,
    /// Zotero item key, or `null`.
    pub zotero_key: Option<String>,
    /// Annotation type; `"highlight"` when Zotero's type is unknown.
    #[serde(rename = "type")]
    pub kind: String,
    /// Colour, or [`DEFAULT_ANNOTATION_COLOR`].
    pub color: String,
    /// Selected text, trimmed.
    pub text: String,
    /// Comment, trimmed.
    pub comment: String,
    /// Tags, unchanged.
    pub tags: Vec<String>,
    /// Rects for fidelity, locus for durability.
    pub anchor: AnchorCombinedPdf,
    /// Zotero's ordering key, or a synthesised equivalent.
    pub sort_index: String,
    /// Creation time.
    pub created_at: String,
    /// Update time.
    pub updated_at: String,
}

/// Trim as JS `String.prototype.trim` does.
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// Trimmed, and `None` when that leaves nothing (the JS `x?.trim() || fallback` shape).
fn trimmed_or_none(value: Option<&str>) -> Option<String> {
    value
        .map(js_trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Keep a list only when it has entries (TS `...(list?.length ? { list } : {})`).
fn non_empty(list: Option<&Vec<Vec<f64>>>) -> Option<Vec<Vec<f64>>> {
    list.filter(|l| !l.is_empty()).cloned()
}

/// Project the annotations, dropping notes, sorted by sort index (stable, as JS `sort`).
///
/// `content_hash` is trimmed; an empty one is absent. `now` defaults to the epoch.
#[must_use]
pub fn project_zotero_annotations(
    annotations: &[ZoteroAnnotationInput],
    content_hash: Option<&str>,
    now: Option<&str>,
) -> Vec<ZoteroReaderAnnotation> {
    let now = now.unwrap_or(EPOCH_ISO).to_owned();
    let content_hash = trimmed_or_none(content_hash);
    let mut out: Vec<ZoteroReaderAnnotation> = Vec::new();

    for ann in annotations {
        if ann.kind.as_deref() == Some("note") {
            continue;
        }
        let kind = ann
            .annotation_type
            .as_deref()
            .filter(|t| is_reader_annotation_type(t))
            .unwrap_or("highlight")
            .to_owned();
        let position = ann.annotation_position.as_ref();
        let page_index = position.and_then(|p| p.page_index);
        let text = trimmed_or_none(ann.text.as_deref());
        let key = trimmed_or_none(ann.key.as_deref());

        let zotero_position =
            page_index
                .filter(|p| *p >= 0.0)
                .map(|page_index| AnchorZoteroPosition {
                    page_index: Some(page_index),
                    rects: position.and_then(|p| non_empty(p.rects.as_ref())),
                    next_page_rects: position.and_then(|p| non_empty(p.next_page_rects.as_ref())),
                    paths: position.and_then(|p| non_empty(p.paths.as_ref())),
                    width: None,
                });
        let locus = text.as_ref().map(|exact| AnchorPdfLocus {
            quote: AnchorQuoteSelector {
                kind: Some("TextQuoteSelector".to_owned()),
                exact: Some(exact.clone()),
                prefix: None,
                suffix: None,
            },
            position: None,
        });

        let sort_index = trimmed_or_none(ann.annotation_sort_index.as_deref())
            .unwrap_or_else(|| build_annotation_sort_index(page_index.unwrap_or(0.0), 0.0, 0.0));

        out.push(ZoteroReaderAnnotation {
            id: key
                .clone()
                .unwrap_or_else(|| format!("zotero-{}", out.len() + 1)),
            origin: "zotero".to_owned(),
            zotero_key: key,
            kind,
            color: trimmed_or_none(ann.color.as_deref())
                .unwrap_or_else(|| DEFAULT_ANNOTATION_COLOR.to_owned()),
            text: text.unwrap_or_default(),
            comment: trimmed_or_none(ann.comment.as_deref()).unwrap_or_default(),
            tags: ann.tags.clone(),
            anchor: AnchorCombinedPdf {
                content_hash: content_hash.clone(),
                zotero_position,
                locus,
            },
            sort_index,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    out.sort_by(|a, b| a.sort_index.cmp(&b.sort_index));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ann(key: &str, text: &str) -> ZoteroAnnotationInput {
        ZoteroAnnotationInput {
            key: Some(key.to_owned()),
            text: Some(text.to_owned()),
            annotation_type: Some("highlight".to_owned()),
            annotation_position: Some(AnchorZoteroPosition {
                page_index: Some(2.0),
                ..AnchorZoteroPosition::default()
            }),
            ..ZoteroAnnotationInput::default()
        }
    }

    #[test]
    fn drops_notes_and_defaults_fields() {
        let note = ZoteroAnnotationInput {
            kind: Some("note".to_owned()),
            ..ann("N1", "x")
        };
        let out = project_zotero_annotations(&[note, ann("A1", "  hi  ")], None, None);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "A1");
        assert_eq!(out[0].text, "hi");
        assert_eq!(out[0].color, DEFAULT_ANNOTATION_COLOR);
        assert_eq!(out[0].created_at, EPOCH_ISO);
        assert_eq!(out[0].zotero_key.as_deref(), Some("A1"));
    }

    #[test]
    fn synthesises_id_and_drops_bad_page() {
        let bare = ZoteroAnnotationInput {
            annotation_type: Some("bogus".to_owned()),
            annotation_position: Some(AnchorZoteroPosition {
                page_index: Some(-1.0),
                ..AnchorZoteroPosition::default()
            }),
            ..ZoteroAnnotationInput::default()
        };
        let out = project_zotero_annotations(&[bare], Some("  "), None);
        assert_eq!(out[0].id, "zotero-1");
        assert_eq!(out[0].kind, "highlight");
        assert_eq!(out[0].anchor.content_hash, None);
        assert_eq!(out[0].anchor.zotero_position, None);
        assert!(!out[0].sort_index.is_empty());
    }

    #[test]
    fn sorts_by_sort_index() {
        let mut late = ann("L", "late");
        late.annotation_sort_index = Some("00009|000000|00000".to_owned());
        let mut early = ann("E", "early");
        early.annotation_sort_index = Some("00001|000000|00000".to_owned());
        let out = project_zotero_annotations(&[late, early], Some("hash"), None);
        assert_eq!(out[0].id, "E");
        assert_eq!(out[0].anchor.content_hash.as_deref(), Some("hash"));
    }
}

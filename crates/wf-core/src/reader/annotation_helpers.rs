//! Pure helpers for local reader annotations (`reader::annotation_helpers`).
//! Port of `apps/web/src/features/reader/application/reader-annotation-helpers.ts`.
//!
//! The palette constants and the pointer and tool predicates stay where they already live (TS
//! constants, `reader::create_tool`). Only the pure record logic moves here.

use serde::{Deserialize, Serialize};

use super::anchor::AnchorCombinedPdf;
use super::annotation_draft::NewReaderAnnotation;
use super::text_units::is_js_space;
use super::viewport::build_annotation_sort_index;
use super::zotero_projection::DEFAULT_ANNOTATION_COLOR;

/// Marks an annotation that exists only on screen, awaiting its server row.
pub const PENDING_ANNOTATION_PREFIX: &str = "pending:";

/// A reader annotation as the app holds it (TS `ReaderAnnotation`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReaderAnnotation {
    /// Annotation id.
    pub id: String,
    /// `local` for a mark made in this app, otherwise where it came from.
    #[cfg_attr(
        feature = "specta",
        specta(type = crate::reader::zotero_sync::ZoteroAnnotationOrigin)
    )]
    pub origin: String,
    /// The Zotero item key, when the mark has been synced to Zotero.
    pub zotero_key: Option<String>,
    /// Annotation kind: `highlight`, `underline`, `note`, `ink`, `image` or `text`.
    #[serde(rename = "type")]
    #[cfg_attr(
        feature = "specta",
        specta(type = crate::reader::zotero_sync::ZoteroAnnotationType)
    )]
    pub kind: String,
    /// Mark colour, as a CSS colour string.
    pub color: String,
    /// Quoted text, or the words of a text box.
    pub text: String,
    /// The reader's note on the mark.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Tags on the mark.
    pub tags: Vec<String>,
    /// Where the mark sits in the PDF.
    pub anchor: AnchorCombinedPdf,
    /// Sort key that orders marks through the document.
    pub sort_index: String,
    /// Creation time, as stored.
    pub created_at: String,
    /// Last-change time, as stored.
    pub updated_at: String,
    /// Sync state of the mark, when tracked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_state: Option<String>,
    /// Zotero's version of the row; `null` until one exists.
    #[serde(default)]
    pub zotero_version: Option<f64>,
}

/// Fields an edit may change. An absent field is left as it was (TS `applyAnnotationPatch`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnnotationPatch {
    /// New comment, when changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// New tags, when changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// New colour, when changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// New text, when changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Pin / quotation-type key: the Zotero key when present and non-blank, else the local id.
#[must_use]
pub fn annotation_pin_key(id: &str, zotero_key: Option<&str>) -> String {
    zotero_key
        .map(|key| key.trim_matches(is_js_space))
        .filter(|key| !key.is_empty())
        .map_or_else(|| id.to_owned(), str::to_owned)
}

/// A colour as stored: trimmed, or the default colour when blank.
fn colour_or_default(raw: &str) -> String {
    let trimmed = raw.trim_matches(is_js_space);
    if trimmed.is_empty() {
        DEFAULT_ANNOTATION_COLOR.to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Apply an edit locally exactly as the repository will store it. The trimming and the
/// blank-colour default mirror the Postgrest repository's `update`, so the optimistic value
/// does not change visibly when the persisted row arrives.
#[must_use]
pub fn apply_annotation_patch(ann: &ReaderAnnotation, patch: &AnnotationPatch) -> ReaderAnnotation {
    let mut next = ann.clone();
    if let Some(color) = &patch.color {
        next.color = colour_or_default(color);
    }
    if let Some(text) = &patch.text {
        next.text = text.trim_matches(is_js_space).to_owned();
    }
    if let Some(comment) = &patch.comment {
        next.comment = Some(comment.trim_matches(is_js_space).to_owned());
    }
    if let Some(tags) = &patch.tags {
        next.tags.clone_from(tags);
    }
    next
}

/// Build the annotation to paint immediately, before the write returns. `now` is the caller's
/// clock reading (ISO-8601), passed in so the function stays pure.
#[must_use]
pub fn optimistic_annotation_from_draft(
    draft: &NewReaderAnnotation,
    id: &str,
    now: &str,
) -> ReaderAnnotation {
    let sort_index = draft.sort_index.trim_matches(is_js_space);
    let sort_index = if sort_index.is_empty() {
        build_annotation_sort_index(draft.page_index, 0.0, 0.0)
    } else {
        sort_index.to_owned()
    };
    ReaderAnnotation {
        id: id.to_owned(),
        origin: "local".to_owned(),
        zotero_key: None,
        kind: draft.kind.clone(),
        color: colour_or_default(&draft.color),
        text: draft.text.trim_matches(is_js_space).to_owned(),
        comment: Some(
            draft
                .comment
                .as_deref()
                .map_or_else(String::new, |comment| {
                    comment.trim_matches(is_js_space).to_owned()
                }),
        ),
        tags: draft.tags.clone(),
        anchor: draft.anchor.clone(),
        sort_index,
        created_at: now.to_owned(),
        updated_at: now.to_owned(),
        sync_state: Some("local".to_owned()),
        zotero_version: None,
    }
}

/// The marks the Annotations list shows and counts: ink is drawing, not a note on the text.
#[must_use]
pub fn listed_annotations(annotations: &[ReaderAnnotation]) -> Vec<ReaderAnnotation> {
    annotations
        .iter()
        .filter(|annotation| annotation.kind != "ink")
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::anchor::AnchorZoteroPosition;
    use crate::reader::create_tool::{PagePress, is_dismiss_tap};

    fn draft(kind: &str, color: &str, page_index: f64) -> NewReaderAnnotation {
        NewReaderAnnotation {
            kind: kind.to_owned(),
            color: color.to_owned(),
            text: String::new(),
            comment: None,
            tags: Vec::new(),
            page_index,
            anchor: AnchorCombinedPdf::default(),
            sort_index: String::new(),
        }
    }

    fn annotation(id: &str, kind: &str) -> ReaderAnnotation {
        ReaderAnnotation {
            id: id.to_owned(),
            origin: "local".to_owned(),
            kind: kind.to_owned(),
            color: DEFAULT_ANNOTATION_COLOR.to_owned(),
            comment: Some(String::new()),
            ..Default::default()
        }
    }

    fn base(draft_value: &NewReaderAnnotation, id: &str) -> ReaderAnnotation {
        optimistic_annotation_from_draft(draft_value, id, "2026-07-29T00:00:00.000Z")
    }

    #[test]
    fn annotation_pin_key_prefers_zotero_key() {
        assert_eq!(annotation_pin_key("local-1", Some("ABCD1234")), "ABCD1234");
        assert_eq!(annotation_pin_key("local-1", None), "local-1");
        assert_eq!(annotation_pin_key("local-1", Some("  ")), "local-1");
    }

    #[test]
    fn optimistic_annotation_mirrors_what_the_repository_will_store() {
        // Painted before the write returns, so it must not differ visibly from the persisted row.
        let anchor = AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(4.0),
                rects: Some(vec![vec![1.0, 2.0, 3.0, 4.0]]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let draft_value = NewReaderAnnotation {
            kind: "highlight".to_owned(),
            color: "  #ff6666  ".to_owned(),
            text: "  quoted  ".to_owned(),
            comment: Some("  note  ".to_owned()),
            tags: Vec::new(),
            page_index: 4.0,
            anchor: anchor.clone(),
            sort_index: "00004|000012|00080".to_owned(),
        };
        let ann = optimistic_annotation_from_draft(
            &draft_value,
            "pending:abc",
            "2026-07-29T00:00:00.000Z",
        );
        assert_eq!(ann.id, "pending:abc");
        assert_eq!(ann.origin, "local");
        assert_eq!(ann.zotero_key, None);
        assert_eq!(ann.color, "#ff6666");
        assert_eq!(ann.text, "quoted");
        assert_eq!(ann.comment.as_deref(), Some("note"));
        assert_eq!(ann.sync_state.as_deref(), Some("local"));
        assert_eq!(ann.sort_index, "00004|000012|00080");
        assert_eq!(ann.anchor, anchor);
    }

    #[test]
    fn optimistic_annotation_fills_the_defaults_the_column_would() {
        let ann = base(&draft("ink", "   ", 2.0), "pending:x");
        assert_eq!(ann.color, "#ffd400");
        assert_eq!(ann.text, "");
        assert_eq!(ann.comment.as_deref(), Some(""));
        assert!(ann.tags.is_empty());
        // Same synthesis the repository uses when a draft omits the sort index.
        assert_eq!(ann.sort_index, "00002|000000|00000");
    }

    // The TS test "pending ids are recognisable..." has an empty body and is not ported.

    #[test]
    fn apply_annotation_patch_normalises_exactly_as_the_repository_does() {
        let mut draft_value = draft("highlight", "#ffd400", 0.0);
        draft_value.anchor = AnchorCombinedPdf::default();
        let before = base(&draft_value, "a1");
        let patched = apply_annotation_patch(
            &before,
            &AnnotationPatch {
                comment: Some("  trimmed  ".to_owned()),
                color: Some("   ".to_owned()),
                tags: Some(vec!["x".to_owned(), "y".to_owned()]),
                text: None,
            },
        );
        assert_eq!(patched.comment.as_deref(), Some("trimmed"));
        assert_eq!(
            patched.color, "#ffd400",
            "blank colour falls back to the default"
        );
        assert_eq!(patched.tags, vec!["x".to_owned(), "y".to_owned()]);
        assert_eq!(patched.id, "a1");
    }

    #[test]
    fn apply_annotation_patch_leaves_untouched_fields_alone() {
        let mut draft_value = draft("note", "#2ea8e5", 1.0);
        draft_value.comment = Some("original".to_owned());
        let before = base(&draft_value, "a2");
        let mut with_tags = before.clone();
        with_tags.tags = vec!["t".to_owned()];
        let patched = apply_annotation_patch(
            &with_tags,
            &AnnotationPatch {
                color: Some("#ff6666".to_owned()),
                ..Default::default()
            },
        );
        assert_eq!(patched.color, "#ff6666");
        assert_eq!(patched.comment.as_deref(), Some("original"));
        assert_eq!(patched.tags, vec!["t".to_owned()]);
    }

    #[test]
    fn apply_annotation_patch_does_not_alias_the_callers_tag_list() {
        let before = base(&draft("highlight", "#ffd400", 0.0), "a3");
        let mut tags = vec!["one".to_owned()];
        let patched = apply_annotation_patch(
            &before,
            &AnnotationPatch {
                tags: Some(tags.clone()),
                ..Default::default()
            },
        );
        tags.push("two".to_owned());
        assert_eq!(
            patched.tags,
            vec!["one".to_owned()],
            "later mutation must not reach the annotation"
        );
    }

    #[test]
    fn listed_annotations_leaves_ink_out_of_the_list_and_its_count() {
        let marks = vec![
            annotation("1", "highlight"),
            annotation("2", "ink"),
            annotation("3", "note"),
            annotation("4", "ink"),
            annotation("5", "underline"),
        ];
        let kinds: Vec<String> = listed_annotations(&marks)
            .into_iter()
            .map(|a| a.kind)
            .collect();
        assert_eq!(kinds, vec!["highlight", "note", "underline"]);
    }

    fn press(x: f64, y: f64, time: f64) -> PagePress {
        PagePress { x, y, time }
    }

    #[test]
    fn is_dismiss_tap_one_short_tap_off_an_open_bar_dismisses_it() {
        let down = press(100.0, 100.0, 0.0);
        assert!(is_dismiss_tap(Some(down), press(102.0, 101.0, 120.0), true));
        assert!(
            !is_dismiss_tap(Some(down), press(102.0, 101.0, 120.0), false),
            "no bar, nothing to dismiss"
        );
        assert!(
            !is_dismiss_tap(Some(down), press(160.0, 100.0, 120.0), true),
            "a drag is a new selection"
        );
        assert!(
            !is_dismiss_tap(Some(down), press(100.0, 100.0, 900.0), true),
            "a long press selects words"
        );
        assert!(!is_dismiss_tap(None, press(100.0, 100.0, 10.0), true));
    }

    // The TS tests on DEFAULT_ANNOTATION_COLOR and READER_ANNOTATION_COLORS check TS constants
    // that stay in TS, so they are not ported.
}

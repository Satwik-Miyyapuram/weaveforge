//! Stored reader annotation row to the app's domain type (TS `toDomain`).
//! Port of `apps/web/src/features/reader/infrastructure/parts-1.ts`.
//!
//! The row is the snake_case shape both backends read from the same table. The mapping keeps the
//! TS defaults: a null `tags` becomes `[]`, a null `anchor` becomes `{}`, an unknown or missing
//! `sync_state` becomes `"local"`, and a null `zotero_key` stays null.

use serde::Deserialize;

use super::anchor::AnchorCombinedPdf;
use super::annotation::{is_annotation_sync_state, is_reader_annotation_type};
use super::annotation_helpers::ReaderAnnotation;

/// One row of the reader annotations table, as the backends read it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReaderAnnotationRow {
    /// Annotation id.
    pub id: String,
    /// Id of the paper the annotation belongs to.
    pub paper_id: String,
    /// `local` or `zotero`.
    pub origin: String,
    /// The Zotero item key, when synced.
    pub zotero_key: Option<String>,
    /// Annotation kind; `type` on the wire.
    #[serde(rename = "type")]
    pub kind: String,
    /// Mark colour.
    pub color: String,
    /// Quoted text, or the words of a text box.
    pub text: String,
    /// The reader's note on the mark.
    pub comment: String,
    /// Tags on the mark, when stored.
    pub tags: Option<Vec<String>>,
    /// Where the mark sits in the PDF, when stored.
    pub anchor: Option<AnchorCombinedPdf>,
    /// Page index the mark sits on, as stored.
    pub page_index: f64,
    /// Sort key that orders marks through the document.
    pub sort_index: String,
    /// Sync state of the row, when tracked.
    #[serde(default)]
    pub sync_state: Option<String>,
    /// Zotero's version of the row, when one exists.
    #[serde(default)]
    pub zotero_version: Option<f64>,
    /// Creation time, as stored.
    pub created_at: String,
    /// Last-change time, as stored.
    pub updated_at: String,
}

/// Map a stored row to the domain annotation.
///
/// # Errors
///
/// Returns `Invalid annotation type in store: <type>` when the row's kind is not a reader
/// annotation type.
pub fn to_domain(row: ReaderAnnotationRow) -> Result<ReaderAnnotation, String> {
    if !is_reader_annotation_type(&row.kind) {
        return Err(format!("Invalid annotation type in store: {}", row.kind));
    }
    let sync_state = row
        .sync_state
        .filter(|state| is_annotation_sync_state(state))
        .unwrap_or_else(|| "local".to_owned());
    Ok(ReaderAnnotation {
        id: row.id,
        origin: row.origin,
        zotero_key: row.zotero_key,
        kind: row.kind,
        color: row.color,
        text: row.text,
        // The TS domain always carries a comment, so the Rust `Some` matches it.
        comment: Some(row.comment),
        tags: row.tags.unwrap_or_default(),
        anchor: row.anchor.unwrap_or_default(),
        sort_index: row.sort_index,
        created_at: row.created_at,
        updated_at: row.updated_at,
        sync_state: Some(sync_state),
        zotero_version: row.zotero_version,
    })
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

    /// A valid row with every optional empty; tests override the field they check.
    fn row() -> ReaderAnnotationRow {
        ReaderAnnotationRow {
            id: "a1".to_owned(),
            paper_id: "p1".to_owned(),
            origin: "local".to_owned(),
            zotero_key: None,
            kind: "highlight".to_owned(),
            color: "yellow".to_owned(),
            text: "quote".to_owned(),
            comment: "note".to_owned(),
            tags: None,
            anchor: None,
            page_index: 0.0,
            sort_index: "00000|000000|00000".to_owned(),
            sync_state: None,
            zotero_version: None,
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn null_tags_become_an_empty_list() {
        let annotation = to_domain(row()).expect("valid kind");
        assert!(annotation.tags.is_empty());
    }

    #[test]
    fn null_zotero_key_stays_null() {
        let annotation = to_domain(row()).expect("valid kind");
        assert_eq!(annotation.zotero_key, None);
    }

    #[test]
    fn missing_or_unknown_sync_state_becomes_local() {
        let missing = to_domain(row()).expect("valid kind");
        assert_eq!(missing.sync_state.as_deref(), Some("local"));
        let unknown = to_domain(ReaderAnnotationRow {
            sync_state: Some("bogus".to_owned()),
            ..row()
        })
        .expect("valid kind");
        assert_eq!(unknown.sync_state.as_deref(), Some("local"));
    }

    #[test]
    fn known_sync_state_is_kept() {
        let annotation = to_domain(ReaderAnnotationRow {
            sync_state: Some("conflict".to_owned()),
            ..row()
        })
        .expect("valid kind");
        assert_eq!(annotation.sync_state.as_deref(), Some("conflict"));
    }

    #[test]
    fn unknown_annotation_type_is_an_error() {
        let result = to_domain(ReaderAnnotationRow {
            kind: "bogus".to_owned(),
            ..row()
        });
        assert_eq!(
            result.err(),
            Some("Invalid annotation type in store: bogus".to_owned())
        );
    }
}

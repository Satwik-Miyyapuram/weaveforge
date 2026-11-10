//! Stored reader annotation row to the app's domain type (TS `toDomain`).
//! Port of `apps/web/src/features/reader/infrastructure/reader-annotation-rows.ts`.
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

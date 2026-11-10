//! How an annotation pin row is stored, and how it maps to the domain pin (TS
//! `features/papers/infrastructure/annotation-pin-rows.ts`).
//!
//! The row shape is the table's column names, shared by every backend provider.

use serde::{Deserialize, Serialize};

/// An annotation pin as stored: the table's column names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnnotationPinRow {
    /// Row id.
    pub id: String,
    /// The paper the pin belongs to.
    pub paper_id: String,
    /// Key of the annotation being pinned.
    pub annotation_key: String,
    /// The report section the pin is attached to.
    pub report_section_id: String,
    /// When the pin was created, as stored.
    pub created_at: String,
}

/// An annotation pin as the domain sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnnotationPin {
    /// Pin id.
    pub id: String,
    /// The paper the pin belongs to.
    pub paper_id: String,
    /// Key of the annotation being pinned.
    pub annotation_key: String,
    /// The report section the pin is attached to.
    pub report_section_id: String,
    /// When the pin was created.
    pub created_at: String,
}

/// Maps a stored row to the domain pin. Fields are copied as they are.
#[must_use]
pub fn to_domain(row: AnnotationPinRow) -> AnnotationPin {
    AnnotationPin {
        id: row.id,
        paper_id: row.paper_id,
        annotation_key: row.annotation_key,
        report_section_id: row.report_section_id,
        created_at: row.created_at,
    }
}

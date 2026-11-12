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

// The TS test on main covers the repository, not this row mapping; cases come from the doc comments.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn row() -> AnnotationPinRow {
        AnnotationPinRow {
            id: "pin-1".to_owned(),
            paper_id: "paper-1".to_owned(),
            annotation_key: "ann-1".to_owned(),
            report_section_id: "sec-1".to_owned(),
            created_at: "2026-11-08T09:00:00Z".to_owned(),
        }
    }

    #[test]
    fn to_domain_copies_every_field_across() {
        let pin = to_domain(row());
        assert_eq!(pin.id, "pin-1");
        assert_eq!(pin.paper_id, "paper-1");
        assert_eq!(pin.annotation_key, "ann-1");
        assert_eq!(pin.report_section_id, "sec-1");
        assert_eq!(pin.created_at, "2026-11-08T09:00:00Z");
    }

    #[test]
    fn to_domain_keeps_created_at_exactly_as_stored() {
        let pin = to_domain(AnnotationPinRow {
            created_at: "not-a-date".to_owned(),
            ..row()
        });
        assert_eq!(pin.created_at, "not-a-date");
    }

    #[test]
    fn to_domain_passes_empty_strings_through_unchanged() {
        let pin = to_domain(AnnotationPinRow {
            id: String::new(),
            paper_id: String::new(),
            annotation_key: String::new(),
            report_section_id: String::new(),
            created_at: String::new(),
        });
        assert_eq!(pin.id, "");
        assert_eq!(pin.paper_id, "");
        assert_eq!(pin.annotation_key, "");
        assert_eq!(pin.report_section_id, "");
        assert_eq!(pin.created_at, "");
    }
}

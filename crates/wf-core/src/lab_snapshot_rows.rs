//! Lab snapshot row mapping (TS `lab-snapshot-rows.ts`). A row is a published snapshot as the
//! `lab_snapshots` table stores it.

use serde::{Deserialize, Serialize};

use crate::lab_snapshot::LabSnapshotContent;

/// A `lab_snapshots` row. `content` is `None` for a row that stored no content.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LabSnapshotRow {
    /// The snapshot's id.
    pub id: String,
    /// The project the snapshot was taken from.
    pub project_id: String,
    /// The snapshot's title.
    pub title: String,
    /// The note the publisher wrote, when any.
    pub note: Option<String>,
    /// The frozen content, when stored.
    pub content: Option<LabSnapshotContent>,
    /// When the snapshot was published (ISO 8601).
    pub published_at: String,
    /// When the row was created (ISO 8601).
    pub created_at: String,
}

/// A published lab snapshot as the app models it (TS `LabSnapshot`). Unset optionals are left
/// out of the serialized object, as `undefined` is in JS.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LabSnapshot {
    /// The snapshot's id.
    pub id: String,
    /// The project the snapshot was taken from.
    pub project_id: String,
    /// The snapshot's title.
    pub title: String,
    /// The publisher's note, when any.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub note: Option<String>,
    /// The frozen content.
    pub content: LabSnapshotContent,
    /// When the snapshot was published (ISO 8601).
    pub published_at: String,
    /// When the row was created (ISO 8601).
    pub created_at: String,
}

/// The snapshot a row maps to (`toDomain`). A row without content gets empty milestones and logs.
#[must_use]
pub fn to_domain(row: &LabSnapshotRow) -> LabSnapshot {
    LabSnapshot {
        id: row.id.clone(),
        project_id: row.project_id.clone(),
        title: row.title.clone(),
        note: row.note.clone(),
        content: row.content.clone().unwrap_or_else(empty_content),
        published_at: row.published_at.clone(),
        created_at: row.created_at.clone(),
    }
}

/// The content of a snapshot stored with none: no milestones and no logs.
fn empty_content() -> LabSnapshotContent {
    LabSnapshotContent {
        milestones: Vec::new(),
        logs: Vec::new(),
        experiments: None,
        report: None,
        ai_assisted: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(content: Option<LabSnapshotContent>, note: Option<&str>) -> LabSnapshotRow {
        LabSnapshotRow {
            id: "s1".into(),
            project_id: "p1".into(),
            title: "Week 3".into(),
            note: note.map(String::from),
            content,
            published_at: "2026-02-01T00:00:00Z".into(),
            created_at: "2026-02-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn missing_content_is_empty() {
        let snapshot = to_domain(&row(None, None));
        assert!(snapshot.content.milestones.is_empty());
        assert!(snapshot.content.logs.is_empty());
        assert!(snapshot.content.experiments.is_none());
        assert!(snapshot.note.is_none());
    }

    #[test]
    fn keeps_note_and_project() {
        let snapshot = to_domain(&row(None, Some("Shared with the group")));
        assert_eq!(snapshot.note.as_deref(), Some("Shared with the group"));
        assert_eq!(snapshot.project_id, "p1");
        assert_eq!(snapshot.published_at, "2026-02-01T00:00:00Z");
    }
}

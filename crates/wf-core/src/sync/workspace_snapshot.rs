//! Port of the types and `workspaceSnapshotCounts` from
//! `packages/core/src/workspace/workspace-snapshot.ts`. Only the fields the
//! serializer reads are kept; `collectWorkspaceSnapshot` (store I/O) is not ported.

use serde::{Deserialize, Deserializer, Serialize};

use crate::sync::json_entities::JsonRow;

/// `null` reads as the default, as the TypeScript's `?? ""` / `?? []` do: stored rows carry
/// `null` where a field was never set.
fn null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// A paper row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnapshotPaper {
    /// Stable id of the paper.
    #[serde(deserialize_with = "null_default")]
    pub id: String,
    /// Paper title.
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    /// Author names, in order.
    #[serde(deserialize_with = "null_default")]
    pub authors: Vec<String>,
    /// Publication year.
    pub year: Option<f64>,
    /// Venue name.
    pub venue: Option<String>,
    /// DOI.
    pub doi: Option<String>,
    /// arXiv id.
    pub arxiv_id: Option<String>,
    /// Source URL.
    pub url: Option<String>,
    /// Abstract text (TS `abstract`).
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    /// The user's own summary.
    pub summary: Option<String>,
    /// Reading status.
    pub status: Option<String>,
    /// User rating.
    pub rating: Option<f64>,
    /// Tags as stored in the app.
    #[serde(deserialize_with = "null_default")]
    pub tags: Vec<String>,
    /// Creation timestamp.
    #[serde(deserialize_with = "null_default")]
    pub created_at: String,
    /// Last update timestamp.
    #[serde(deserialize_with = "null_default")]
    pub updated_at: String,
}

/// A vault page (note) row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnapshotVaultPage {
    /// Stable id of the page.
    #[serde(deserialize_with = "null_default")]
    pub id: String,
    /// Page title.
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    /// Page body, markdown or an ink note body.
    #[serde(deserialize_with = "null_default")]
    pub body: String,
    /// Parent page id, for nested pages.
    pub parent_id: Option<String>,
    /// Creation timestamp.
    #[serde(deserialize_with = "null_default")]
    pub created_at: String,
    /// Last update timestamp.
    #[serde(deserialize_with = "null_default")]
    pub updated_at: String,
}

/// A reading list row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnapshotReadingList {
    /// Stable id of the list.
    #[serde(deserialize_with = "null_default")]
    pub id: String,
    /// List name.
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    /// Free-text description.
    pub description: Option<String>,
    /// Parent list id, for nested lists.
    pub parent_id: Option<String>,
    /// Display colour.
    pub color: Option<String>,
    /// Creation timestamp.
    #[serde(deserialize_with = "null_default")]
    pub created_at: String,
}

/// A report section row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnapshotReportSection {
    /// Stable id of the section.
    #[serde(deserialize_with = "null_default")]
    pub id: String,
    /// Section title.
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    /// Section number, e.g. `2.1`.
    pub section_no: Option<String>,
    /// Parent section id, for nested sections.
    pub parent_id: Option<String>,
    /// Writing status.
    pub status: Option<String>,
    /// Target word count.
    pub target_words: Option<f64>,
    /// Deadline text.
    pub deadline: Option<String>,
    /// Free-text notes.
    pub notes: Option<String>,
    /// Last edit timestamp; empty when the serializer omits it.
    #[serde(deserialize_with = "null_default")]
    pub updated_at: String,
    /// Creation timestamp.
    #[serde(deserialize_with = "null_default")]
    pub created_at: String,
}

/// An experiment row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnapshotExperiment {
    /// Stable id of the experiment.
    #[serde(deserialize_with = "null_default")]
    pub id: String,
    /// Experiment name.
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    /// Stated hypothesis.
    pub hypothesis: Option<String>,
    /// Status text.
    pub status: Option<String>,
    /// Repository URL.
    pub repo_url: Option<String>,
    /// Commit sha.
    pub commit_sha: Option<String>,
    /// Branch name.
    pub branch: Option<String>,
    /// Result notes.
    pub result_note: Option<String>,
    /// Command that runs the experiment.
    pub run_command: Option<String>,
    /// Start timestamp.
    pub started_at: Option<String>,
    /// Finish timestamp, set once the status is terminal.
    pub finished_at: Option<String>,
    /// Creation timestamp.
    #[serde(deserialize_with = "null_default")]
    pub created_at: String,
}

/// A milestone row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnapshotMilestone {
    /// Stable id of the milestone.
    #[serde(deserialize_with = "null_default")]
    pub id: String,
    /// Milestone title.
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    /// Free-text description.
    pub description: Option<String>,
    /// Status text.
    pub status: Option<String>,
    /// Target date.
    pub target_date: Option<String>,
    /// Creation timestamp.
    #[serde(deserialize_with = "null_default")]
    pub created_at: String,
}

/// A log entry row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnapshotLogEntry {
    /// Stable id of the entry.
    #[serde(deserialize_with = "null_default")]
    pub id: String,
    /// Date the entry is for, `YYYY-MM-DD`.
    #[serde(deserialize_with = "null_default")]
    pub entry_date: String,
    /// Entry kind.
    #[serde(deserialize_with = "null_default")]
    pub kind: String,
    /// Entry body.
    #[serde(deserialize_with = "null_default")]
    pub body: String,
    /// Creation timestamp.
    #[serde(deserialize_with = "null_default")]
    pub created_at: String,
}

/// Everything the workspace export reads, as one snapshot.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceSnapshot {
    /// Papers.
    #[serde(deserialize_with = "null_default")]
    pub papers: Vec<SnapshotPaper>,
    /// Vault pages (notes).
    #[serde(deserialize_with = "null_default")]
    pub vault_pages: Vec<SnapshotVaultPage>,
    /// Reading lists.
    #[serde(deserialize_with = "null_default")]
    pub reading_lists: Vec<SnapshotReadingList>,
    /// Reading list membership rows, as stored.
    #[serde(deserialize_with = "null_default")]
    pub reading_list_items: Vec<JsonRow>,
    /// Report sections.
    #[serde(deserialize_with = "null_default")]
    pub report_sections: Vec<SnapshotReportSection>,
    /// Experiments.
    #[serde(deserialize_with = "null_default")]
    pub experiments: Vec<SnapshotExperiment>,
    /// Milestones.
    #[serde(deserialize_with = "null_default")]
    pub milestones: Vec<SnapshotMilestone>,
    /// Log entries.
    #[serde(deserialize_with = "null_default")]
    pub log_entries: Vec<SnapshotLogEntry>,
    /// Paper-to-paper relation rows, as stored.
    #[serde(deserialize_with = "null_default")]
    pub relations: Vec<JsonRow>,
    /// Tag rows, as stored.
    #[serde(deserialize_with = "null_default")]
    pub tags: Vec<JsonRow>,
    /// Reader annotation rows, as stored.
    #[serde(deserialize_with = "null_default")]
    pub reader_annotations: Vec<JsonRow>,
    /// When the snapshot was taken, ISO-8601.
    #[serde(deserialize_with = "null_default")]
    pub collected_at: String,
}

/// How many rows of each kind a snapshot holds.
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotCounts {
    /// Number of papers.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub papers: usize,
    /// Number of vault pages (notes).
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub notes: usize,
    /// Number of reading lists.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub reading_lists: usize,
    /// Number of report sections.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub report_sections: usize,
    /// Number of experiments.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub experiments: usize,
    /// Number of milestones.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub milestones: usize,
    /// Number of log entries.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub log_entries: usize,
    /// Number of relation rows.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub relations: usize,
    /// Number of tag rows.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub tags: usize,
}

/// Row counts of `snapshot`, as the manifest records them.
#[must_use]
pub fn workspace_snapshot_counts(snapshot: &WorkspaceSnapshot) -> WorkspaceSnapshotCounts {
    WorkspaceSnapshotCounts {
        papers: snapshot.papers.len(),
        notes: snapshot.vault_pages.len(),
        reading_lists: snapshot.reading_lists.len(),
        report_sections: snapshot.report_sections.len(),
        experiments: snapshot.experiments.len(),
        milestones: snapshot.milestones.len(),
        log_entries: snapshot.log_entries.len(),
        relations: snapshot.relations.len(),
        tags: snapshot.tags.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshot_reads_camel_case_json_with_nulls_and_missing_fields() {
        let snapshot: WorkspaceSnapshot = serde_json::from_str(
            r#"{"papers":[{"id":"p1","title":null,"authors":null,"year":2020,"abstract":"A","arxivId":"2101.1","extra":1}],"vaultPages":[{"id":"n1","title":"T","body":"B","parentId":null}],"collectedAt":"2026-01-01"}"#,
        )
        .unwrap();

        let paper = &snapshot.papers[0];
        assert_eq!(paper.title, "");
        assert!(paper.authors.is_empty());
        assert_eq!(paper.year, Some(2020.0));
        assert_eq!(paper.abstract_text.as_deref(), Some("A"));
        assert_eq!(paper.arxiv_id.as_deref(), Some("2101.1"));
        assert_eq!(paper.created_at, "");
        assert_eq!(snapshot.vault_pages[0].parent_id, None);
        assert!(snapshot.reading_lists.is_empty());
        assert_eq!(snapshot.collected_at, "2026-01-01");
    }

    #[test]
    fn experiment_reads_run_command_and_run_timestamps() {
        let snapshot: WorkspaceSnapshot = serde_json::from_str(
            r#"{"experiments":[{"id":"e1","name":"Run","runCommand":"python train.py","startedAt":"2026-02-01T09:00:00Z","finishedAt":"2026-02-01T10:00:00Z","createdAt":"2026-01-30"}]}"#,
        )
        .unwrap();

        let experiment = &snapshot.experiments[0];
        assert_eq!(experiment.run_command.as_deref(), Some("python train.py"));
        assert_eq!(experiment.started_at.as_deref(), Some("2026-02-01T09:00:00Z"));
        assert_eq!(experiment.finished_at.as_deref(), Some("2026-02-01T10:00:00Z"));
    }

    #[test]
    fn counts_serialize_camel_case() {
        let snapshot = WorkspaceSnapshot {
            papers: vec![SnapshotPaper::default(), SnapshotPaper::default()],
            reading_lists: vec![SnapshotReadingList::default()],
            ..Default::default()
        };

        assert_eq!(
            serde_json::to_value(workspace_snapshot_counts(&snapshot)).unwrap(),
            json!({"papers":2,"notes":0,"readingLists":1,"reportSections":0,"experiments":0,"milestones":0,"logEntries":0,"relations":0,"tags":0})
        );
    }
}

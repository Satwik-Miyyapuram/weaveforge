//! Port of the types and `workspaceSnapshotCounts` from
//! `packages/core/src/workspace/workspace-snapshot.ts`. Only the fields the
//! serializer reads are kept; `collectWorkspaceSnapshot` (store I/O) is not ported.

use crate::sync::json_entities::JsonRow;

/// A paper row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SnapshotPaper {
    /// Stable id of the paper.
    pub id: String,
    /// Paper title.
    pub title: String,
    /// Author names, in order.
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
    pub abstract_text: Option<String>,
    /// The user's own summary.
    pub summary: Option<String>,
    /// Reading status.
    pub status: Option<String>,
    /// User rating.
    pub rating: Option<f64>,
    /// Tags as stored in the app.
    pub tags: Vec<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

/// A vault page (note) row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SnapshotVaultPage {
    /// Stable id of the page.
    pub id: String,
    /// Page title.
    pub title: String,
    /// Page body, markdown or an ink note body.
    pub body: String,
    /// Parent page id, for nested pages.
    pub parent_id: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}

/// A reading list row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SnapshotReadingList {
    /// Stable id of the list.
    pub id: String,
    /// List name.
    pub name: String,
    /// Free-text description.
    pub description: Option<String>,
    /// Parent list id, for nested lists.
    pub parent_id: Option<String>,
    /// Display colour.
    pub color: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
}

/// A report section row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SnapshotReportSection {
    /// Stable id of the section.
    pub id: String,
    /// Section title.
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
    /// Creation timestamp.
    pub created_at: String,
}

/// An experiment row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SnapshotExperiment {
    /// Stable id of the experiment.
    pub id: String,
    /// Experiment name.
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
    /// Creation timestamp.
    pub created_at: String,
}

/// A milestone row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SnapshotMilestone {
    /// Stable id of the milestone.
    pub id: String,
    /// Milestone title.
    pub title: String,
    /// Free-text description.
    pub description: Option<String>,
    /// Status text.
    pub status: Option<String>,
    /// Target date.
    pub target_date: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
}

/// A log entry row as the serializer reads it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SnapshotLogEntry {
    /// Stable id of the entry.
    pub id: String,
    /// Date the entry is for, `YYYY-MM-DD`.
    pub entry_date: String,
    /// Entry kind.
    pub kind: String,
    /// Entry body.
    pub body: String,
    /// Creation timestamp.
    pub created_at: String,
}

/// Everything the workspace export reads, as one snapshot.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WorkspaceSnapshot {
    /// Papers.
    pub papers: Vec<SnapshotPaper>,
    /// Vault pages (notes).
    pub vault_pages: Vec<SnapshotVaultPage>,
    /// Reading lists.
    pub reading_lists: Vec<SnapshotReadingList>,
    /// Reading list membership rows, as stored.
    pub reading_list_items: Vec<JsonRow>,
    /// Report sections.
    pub report_sections: Vec<SnapshotReportSection>,
    /// Experiments.
    pub experiments: Vec<SnapshotExperiment>,
    /// Milestones.
    pub milestones: Vec<SnapshotMilestone>,
    /// Log entries.
    pub log_entries: Vec<SnapshotLogEntry>,
    /// Paper-to-paper relation rows, as stored.
    pub relations: Vec<JsonRow>,
    /// Tag rows, as stored.
    pub tags: Vec<JsonRow>,
    /// Reader annotation rows, as stored.
    pub reader_annotations: Vec<JsonRow>,
    /// When the snapshot was taken, ISO-8601.
    pub collected_at: String,
}

/// How many rows of each kind a snapshot holds.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WorkspaceSnapshotCounts {
    /// Number of papers.
    pub papers: usize,
    /// Number of vault pages (notes).
    pub notes: usize,
    /// Number of reading lists.
    pub reading_lists: usize,
    /// Number of report sections.
    pub report_sections: usize,
    /// Number of experiments.
    pub experiments: usize,
    /// Number of milestones.
    pub milestones: usize,
    /// Number of log entries.
    pub log_entries: usize,
    /// Number of relation rows.
    pub relations: usize,
    /// Number of tag rows.
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

//! Port of packages/core/src/features/org/domain/parts.ts. Pure.

use crate::experiment_status::ExperimentStatus;
use crate::report::report_section::ReportStatus;

/// A milestone's status (TS `MilestoneStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum MilestoneStatus {
    /// Not started.
    Planned,
    /// Being worked on.
    InProgress,
    /// Finished.
    Done,
    /// Waiting on something.
    Blocked,
}

pub use crate::logbook::log_entry::LogKind;

/// A live milestone, as the snapshot reads it (TS `Milestone`, subset).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MilestoneInput {
    /// Milestone id.
    pub id: String,
    /// Display title.
    pub title: String,
    /// Optional description.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub description: Option<String>,
    /// Current status.
    pub status: MilestoneStatus,
    /// Target date (yyyy-mm-dd).
    #[cfg_attr(feature = "specta", specta(optional))]
    pub target_date: Option<String>,
}

/// A live log entry, as the snapshot reads it (TS `LogEntry`, subset).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LogEntryInput {
    /// Log entry id.
    pub id: String,
    /// Calendar date (yyyy-mm-dd) the entry is about.
    pub entry_date: String,
    /// Daily or weekly.
    pub kind: LogKind,
    /// Markdown body.
    pub body: String,
}

/// A live experiment, as the snapshot reads it (TS `Experiment`, subset).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExperimentInput {
    /// Experiment id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Current status.
    pub status: ExperimentStatus,
    /// Optional result note.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub result_note: Option<String>,
}

/// A live report section, as the snapshot reads it (TS `ReportSection`, subset).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReportSectionInput {
    /// Section id.
    pub id: String,
    /// Section title.
    pub title: String,
    /// Writing status.
    pub status: ReportStatus,
    /// Words written so far.
    pub word_count: f64,
}

/// The live records `buildLabSnapshotContent` freezes (its TS parameter object).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BuildLabSnapshotInput {
    /// Milestones to freeze.
    pub milestones: Vec<MilestoneInput>,
    /// Log entries to freeze.
    pub logs: Vec<LogEntryInput>,
    /// Experiments to freeze.
    pub experiments: Vec<ExperimentInput>,
    /// Report sections to freeze.
    pub report: Vec<ReportSectionInput>,
    /// AI suggestions the student accepted in this project.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub ai_assisted: Option<f64>,
}

/// Frozen milestone fields in a lab snapshot (TS `LabSnapshotMilestone`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LabSnapshotMilestone {
    /// Milestone id.
    pub id: String,
    /// Display title.
    pub title: String,
    /// Description, when the milestone has one.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub description: Option<String>,
    /// Status at freeze time.
    pub status: MilestoneStatus,
    /// Target date, when set.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub target_date: Option<String>,
}

/// Frozen log entry fields in a lab snapshot (TS `LabSnapshotLog`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LabSnapshotLog {
    /// Log entry id.
    pub id: String,
    /// Calendar date (yyyy-mm-dd).
    pub entry_date: String,
    /// Daily or weekly.
    pub kind: LogKind,
    /// Markdown body.
    pub body: String,
}

/// Frozen experiment fields in a lab snapshot (TS `LabSnapshotExperiment`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LabSnapshotExperiment {
    /// Experiment id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Status at freeze time.
    pub status: ExperimentStatus,
    /// Result note, when set.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub result_note: Option<String>,
}

/// Frozen report section progress in a lab snapshot (TS `LabSnapshotReportSection`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LabSnapshotReportSection {
    /// Section id.
    pub id: String,
    /// Section title.
    pub title: String,
    /// Writing status at freeze time.
    pub status: ReportStatus,
    /// Words written at freeze time.
    pub word_count: f64,
}

/// Snapshots published before experiments, report and AI counts existed lack those fields
/// (TS `LabSnapshotContent`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LabSnapshotContent {
    /// Frozen milestones.
    pub milestones: Vec<LabSnapshotMilestone>,
    /// Frozen log entries.
    pub logs: Vec<LabSnapshotLog>,
    /// Frozen experiments; absent in older snapshots.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub experiments: Option<Vec<LabSnapshotExperiment>>,
    /// Frozen report sections; absent in older snapshots.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub report: Option<Vec<LabSnapshotReportSection>>,
    /// AI suggestions accepted; absent in older snapshots.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub ai_assisted: Option<f64>,
}

/// `buildLabSnapshotContent`: freeze live records into snapshot content, keeping only what a
/// supervisor reads.
#[must_use]
pub fn build_lab_snapshot_content(input: BuildLabSnapshotInput) -> LabSnapshotContent {
    LabSnapshotContent {
        milestones: input
            .milestones
            .into_iter()
            .map(|m| LabSnapshotMilestone {
                id: m.id,
                title: m.title,
                description: m.description,
                status: m.status,
                target_date: m.target_date,
            })
            .collect(),
        logs: input
            .logs
            .into_iter()
            .map(|l| LabSnapshotLog {
                id: l.id,
                entry_date: l.entry_date,
                kind: l.kind,
                body: l.body,
            })
            .collect(),
        experiments: Some(
            input
                .experiments
                .into_iter()
                .map(|e| LabSnapshotExperiment {
                    id: e.id,
                    name: e.name,
                    status: e.status,
                    result_note: e.result_note,
                })
                .collect(),
        ),
        report: Some(
            input
                .report
                .into_iter()
                .map(|r| LabSnapshotReportSection {
                    id: r.id,
                    title: r.title,
                    status: r.status,
                    word_count: r.word_count,
                })
                .collect(),
        ),
        ai_assisted: input.ai_assisted,
    }
}

/// Trim a lab snapshot title. Blank titles are rejected.
pub fn validate_snapshot_title(title: &str) -> Result<String, &'static str> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("Snapshot title is required.");
    }
    Ok(trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_only_read_fields_and_omits_absent_optionals() {
        let input: BuildLabSnapshotInput = serde_json::from_value(json!({
            "milestones": [{ "id": "m1", "title": "Draft", "status": "in_progress", "extra": 1 }],
            "logs": [{ "id": "l1", "entryDate": "2026-11-05", "kind": "daily", "body": "x", "links": [] }],
            "experiments": [{ "id": "e1", "name": "run", "status": "done", "config": {} }],
            "report": [{ "id": "s1", "title": "Intro", "status": "review", "wordCount": 120 }]
        }))
        .unwrap();
        let value = serde_json::to_value(build_lab_snapshot_content(input)).unwrap();
        assert_eq!(
            value,
            json!({
                "milestones": [{ "id": "m1", "title": "Draft", "status": "in_progress" }],
                "logs": [{ "id": "l1", "entryDate": "2026-11-05", "kind": "daily", "body": "x" }],
                "experiments": [{ "id": "e1", "name": "run", "status": "done" }],
                "report": [{ "id": "s1", "title": "Intro", "status": "review", "wordCount": 120.0 }]
            })
        );
    }

    #[test]
    fn keeps_optional_fields_when_present() {
        let input: BuildLabSnapshotInput = serde_json::from_value(json!({
            "milestones": [{ "id": "m1", "title": "T", "description": "d", "status": "done", "targetDate": "2026-12-01" }],
            "logs": [],
            "experiments": [{ "id": "e1", "name": "n", "status": "failed", "resultNote": "bad" }],
            "report": [],
            "aiAssisted": 3
        }))
        .unwrap();
        let value = serde_json::to_value(build_lab_snapshot_content(input)).unwrap();
        assert_eq!(value["milestones"][0]["description"], "d");
        assert_eq!(value["milestones"][0]["targetDate"], "2026-12-01");
        assert_eq!(value["experiments"][0]["resultNote"], "bad");
        assert_eq!(value["aiAssisted"], 3.0);
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod title_tests {
    use super::*;

    #[test]
    fn snapshot_title_is_trimmed_and_required() {
        assert_eq!(
            validate_snapshot_title("  Week 3 "),
            Ok("Week 3".to_owned())
        );
        assert_eq!(
            validate_snapshot_title("   "),
            Err("Snapshot title is required.")
        );
        assert_eq!(
            validate_snapshot_title(""),
            Err("Snapshot title is required.")
        );
    }
}

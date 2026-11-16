//! Experiment row mapping (TS `experiment-rows.ts`). A row is an `experiments` table row with
//! snake_case columns. Both backend providers read and write the same table, so the mapping
//! lives here once.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::experiment_status::ExperimentStatus;
use crate::experiments::Experiment;

/// An `experiments` row as read. Nullable columns are `None` when the row has no value;
/// `config`, `metrics` and `artifacts` default to empty when missing.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExperimentRow {
    /// The experiment's id.
    pub id: String,
    /// The experiment's name.
    pub name: String,
    /// The hypothesis, when stated.
    pub hypothesis: Option<String>,
    /// The run's status.
    pub status: ExperimentStatus,
    /// The code repository the run uses.
    pub repo_url: Option<String>,
    /// The commit the run uses.
    pub commit_sha: Option<String>,
    /// The branch the run uses.
    pub branch: Option<String>,
    /// The command that starts the run.
    pub run_command: Option<String>,
    /// The run's configuration.
    #[cfg_attr(feature = "specta", specta(type = Option<std::collections::BTreeMap<String, specta_typescript::Unknown>>))]
    pub config: Option<Map<String, Value>>,
    /// The run's recorded metric summary.
    #[cfg_attr(feature = "specta", specta(type = Option<std::collections::BTreeMap<String, specta_typescript::Unknown>>))]
    pub metrics: Option<Map<String, Value>>,
    /// Artifact paths the run produced.
    pub artifacts: Option<Vec<String>>,
    /// The result note, when written.
    pub result_note: Option<String>,
    /// When the run started (ISO 8601), when recorded.
    pub started_at: Option<String>,
    /// When the run finished (ISO 8601), when recorded.
    pub finished_at: Option<String>,
    /// The related paper's id, when linked.
    pub related_paper: Option<String>,
    /// When the row was created (ISO 8601).
    pub created_at: String,
}

/// An `experiments` row as written. Every column is present; an unset value is `null`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExperimentWriteRow {
    /// The experiment's id.
    pub id: String,
    /// The experiment's name.
    pub name: String,
    /// The hypothesis, or `null`.
    pub hypothesis: Option<String>,
    /// The run's status.
    pub status: ExperimentStatus,
    /// The code repository, or `null`.
    pub repo_url: Option<String>,
    /// The commit, or `null`.
    pub commit_sha: Option<String>,
    /// The branch, or `null`.
    pub branch: Option<String>,
    /// The run command, or `null`.
    pub run_command: Option<String>,
    /// The run's configuration.
    #[cfg_attr(feature = "specta", specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    pub config: Map<String, Value>,
    /// The run's metric summary.
    #[cfg_attr(feature = "specta", specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    pub metrics: Map<String, Value>,
    /// The artifact paths.
    pub artifacts: Vec<String>,
    /// The result note, or `null`.
    pub result_note: Option<String>,
    /// The start time, or `null`.
    pub started_at: Option<String>,
    /// The finish time, or `null`.
    pub finished_at: Option<String>,
    /// The related paper's id, or `null`.
    pub related_paper: Option<String>,
    /// When the run was created.
    pub created_at: String,
}

/// The experiment a row maps to (`experimentToDomain`). Missing configuration and metrics are
/// empty objects, and missing artifacts an empty list.
#[must_use]
pub fn to_domain(row: &ExperimentRow) -> Experiment {
    Experiment {
        id: row.id.clone(),
        name: row.name.clone(),
        hypothesis: row.hypothesis.clone(),
        status: row.status,
        repo_url: row.repo_url.clone(),
        commit_sha: row.commit_sha.clone(),
        branch: row.branch.clone(),
        run_command: row.run_command.clone(),
        config: row.config.clone().unwrap_or_default(),
        metrics: row.metrics.clone().unwrap_or_default(),
        artifacts: row.artifacts.clone().unwrap_or_default(),
        result_note: row.result_note.clone(),
        started_at: row.started_at.clone(),
        finished_at: row.finished_at.clone(),
        related_paper: row.related_paper.clone(),
        created_at: row.created_at.clone(),
    }
}

/// The row an experiment is written as (`experimentToRow`). Unset optionals are written as `null`.
#[must_use]
pub fn to_row(experiment: &Experiment) -> ExperimentWriteRow {
    ExperimentWriteRow {
        id: experiment.id.clone(),
        name: experiment.name.clone(),
        hypothesis: experiment.hypothesis.clone(),
        status: experiment.status,
        repo_url: experiment.repo_url.clone(),
        commit_sha: experiment.commit_sha.clone(),
        branch: experiment.branch.clone(),
        run_command: experiment.run_command.clone(),
        config: experiment.config.clone(),
        metrics: experiment.metrics.clone(),
        artifacts: experiment.artifacts.clone(),
        result_note: experiment.result_note.clone(),
        started_at: experiment.started_at.clone(),
        finished_at: experiment.finished_at.clone(),
        related_paper: experiment.related_paper.clone(),
        created_at: experiment.created_at.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> ExperimentRow {
        ExperimentRow {
            id: "e1".into(),
            name: "Baseline".into(),
            hypothesis: None,
            status: ExperimentStatus::Running,
            repo_url: None,
            commit_sha: None,
            branch: None,
            run_command: None,
            config: None,
            metrics: None,
            artifacts: None,
            result_note: None,
            started_at: None,
            finished_at: None,
            related_paper: None,
            created_at: "2026-03-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn missing_collections_are_empty() {
        let e = to_domain(&row());
        assert!(e.config.is_empty());
        assert!(e.metrics.is_empty());
        assert!(e.artifacts.is_empty());
        assert!(e.hypothesis.is_none());
    }

    #[test]
    fn unset_optionals_write_as_null() {
        let write = to_row(&to_domain(&row()));
        assert!(write.hypothesis.is_none());
        assert!(write.started_at.is_none());
        assert_eq!(write.name, "Baseline");
        assert_eq!(write.created_at, "2026-03-01T00:00:00Z");
    }
}

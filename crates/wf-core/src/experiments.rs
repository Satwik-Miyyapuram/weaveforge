//! Metric point downsampling: keep every point below `KEEP_ALL_BELOW_STEP`, then halve the
//! sample rate once per octave of step. Keyed on `step` alone so ingest is idempotent.

use serde_json::{Map, Value};

use crate::experiment_status::{ExperimentStatus, TERMINAL_EXPERIMENT_STATUSES};
use crate::reader_analysis::lines::js_trim;

/// Below this step every point is kept, whatever the metric.
pub const KEEP_ALL_BELOW_STEP: f64 = 10_000.0;

/// The sampling interval in force at `step`: 1 below the threshold, then doubling per octave.
#[must_use]
pub fn stride_for_step(step: f64) -> f64 {
    if !step.is_finite() || step < KEEP_ALL_BELOW_STEP {
        return 1.0;
    }
    let octaves = (step / KEEP_ALL_BELOW_STEP).log2().ceil();
    2f64.powf(octaves.max(0.0))
}

/// Whether a point at this step sits on the sampling grid.
#[must_use]
pub fn is_on_sampling_grid(step: f64) -> bool {
    if !step.is_finite() {
        return false;
    }
    // Non-positive steps are always kept; a modulo on them is not well defined.
    if step <= 0.0 {
        return true;
    }
    step % stride_for_step(step) == 0.0
}

/// Indices to write for one series, plus the previous tip step to delete.
#[derive(Debug, Clone, PartialEq)]
pub struct DownsampleDecision {
    /// Indices into the input steps to write, in ascending order.
    pub keep: Vec<usize>,
    /// Previously stored newest step that is now superseded and off the grid.
    pub superseded_tip_step: Option<f64>,
}

/// Decide what to store for one series, given the arriving steps and the highest stored step.
#[must_use]
pub fn plan_series_ingest(steps: &[f64], previous_max_step: Option<f64>) -> DownsampleDecision {
    let mut batch_max_step = f64::NEG_INFINITY;
    for &step in steps {
        if step > batch_max_step {
            batch_max_step = step;
        }
    }

    // The newest point is kept even off the grid, so a curve does not stop at the last grid step.
    let keep = steps
        .iter()
        .enumerate()
        .filter(|&(_, &step)| is_on_sampling_grid(step) || step == batch_max_step)
        .map(|(index, _)| index)
        .collect();

    // A previous tip is only worth keeping while it is still the newest point.
    let superseded_tip_step = previous_max_step
        .filter(|&previous| previous < batch_max_step && !is_on_sampling_grid(previous));

    DownsampleDecision {
        keep,
        superseded_tip_step,
    }
}

/// Steps to delete from an already-stored series: off-grid steps, except the newest.
#[must_use]
pub fn steps_to_prune(stored_steps: &[f64]) -> Vec<f64> {
    let mut max_step = f64::NEG_INFINITY;
    for &step in stored_steps {
        if step > max_step {
            max_step = step;
        }
    }
    stored_steps
        .iter()
        .copied()
        .filter(|&step| step != max_step && !is_on_sampling_grid(step))
        .collect()
}

/// TS `NewExperimentInput`. `name` is optional here so a missing name gets the TS validation message.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs, reason = "fields mirror the TS type one to one")]
pub struct NewExperimentInput {
    pub name: Option<String>,
    pub hypothesis: Option<String>,
    pub status: Option<ExperimentStatus>,
    pub repo_url: Option<String>,
    pub commit_sha: Option<String>,
    pub branch: Option<String>,
    pub run_command: Option<String>,
    pub config: Option<Map<String, Value>>,
    pub metrics: Option<Map<String, Value>>,
    pub artifacts: Option<Vec<String>>,
    pub result_note: Option<String>,
    pub related_paper: Option<String>,
}

/// TS `Experiment`. Unset optionals are left out of the serialized object, as `undefined` is in JS.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs, reason = "fields mirror the TS type one to one")]
pub struct Experiment {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hypothesis: Option<String>,
    pub status: ExperimentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_command: Option<String>,
    pub config: Map<String, Value>,
    pub metrics: Map<String, Value>,
    pub artifacts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_paper: Option<String>,
    pub created_at: String,
}

/// [`createExperiment`]: a new run with `id` and `now` supplied by the caller (TS generates both).
///
/// # Errors
///
/// Returns the TS validation message when the trimmed name is empty.
pub fn create_experiment(
    input: &NewExperimentInput,
    id: &str,
    now: &str,
) -> Result<Experiment, String> {
    let name = js_trim(input.name.as_deref().unwrap_or(""));
    if name.is_empty() {
        return Err("Experiment name is required.".to_owned());
    }
    let status = input.status.unwrap_or(ExperimentStatus::Planned);
    Ok(Experiment {
        id: id.to_owned(),
        name: name.to_owned(),
        hypothesis: input.hypothesis.clone(),
        status,
        repo_url: input.repo_url.clone(),
        commit_sha: input.commit_sha.as_deref().map(|s| js_trim(s).to_owned()),
        branch: input.branch.as_deref().map(|s| js_trim(s).to_owned()),
        run_command: input.run_command.clone(),
        config: input.config.clone().unwrap_or_default(),
        metrics: input.metrics.clone().unwrap_or_default(),
        artifacts: input.artifacts.clone().unwrap_or_default(),
        result_note: input.result_note.clone(),
        started_at: (status == ExperimentStatus::Running).then(|| now.to_owned()),
        finished_at: TERMINAL_EXPERIMENT_STATUSES
            .contains(&status)
            .then(|| now.to_owned()),
        related_paper: input.related_paper.clone(),
        created_at: now.to_owned(),
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod create_tests {
    use super::*;

    fn input(name: &str) -> NewExperimentInput {
        NewExperimentInput {
            name: Some(name.to_owned()),
            ..NewExperimentInput::default()
        }
    }

    #[test]
    fn trims_name_and_defaults_to_planned() {
        let made = create_experiment(&input("  run A  "), "id1", "t0").unwrap();
        assert_eq!(made.id, "id1");
        assert_eq!(made.name, "run A");
        assert_eq!(made.status, ExperimentStatus::Planned);
        assert_eq!(made.created_at, "t0");
        assert_eq!(made.started_at, None);
        assert_eq!(made.finished_at, None);
        assert!(made.config.is_empty());
        assert!(made.artifacts.is_empty());
    }

    #[test]
    fn blank_or_missing_name_is_rejected() {
        let msg = "Experiment name is required.";
        assert_eq!(create_experiment(&input("   "), "i", "t").unwrap_err(), msg);
        let missing = NewExperimentInput::default();
        assert_eq!(create_experiment(&missing, "i", "t").unwrap_err(), msg);
    }

    #[test]
    fn running_stamps_start_only() {
        let run = NewExperimentInput {
            status: Some(ExperimentStatus::Running),
            ..input("r")
        };
        let made = create_experiment(&run, "i", "now").unwrap();
        assert_eq!(made.started_at.as_deref(), Some("now"));
        assert_eq!(made.finished_at, None);
    }

    #[test]
    fn terminal_status_stamps_finish_only() {
        for status in TERMINAL_EXPERIMENT_STATUSES {
            let made = create_experiment(
                &NewExperimentInput {
                    status: Some(*status),
                    ..input("x")
                },
                "i",
                "now",
            )
            .unwrap();
            assert_eq!(made.finished_at.as_deref(), Some("now"));
            assert_eq!(made.started_at, None);
        }
    }

    #[test]
    fn commit_and_branch_are_trimmed_not_dropped() {
        let made = create_experiment(
            &NewExperimentInput {
                commit_sha: Some("  abc  ".to_owned()),
                branch: Some("  ".to_owned()),
                ..input("x")
            },
            "i",
            "t",
        )
        .unwrap();
        assert_eq!(made.commit_sha.as_deref(), Some("abc"));
        assert_eq!(made.branch.as_deref(), Some(""));
    }

    #[test]
    fn other_fields_pass_through_unchanged() {
        let mut config = Map::new();
        let _ = config.insert("lr".to_owned(), Value::from(0.1));
        let made = create_experiment(
            &NewExperimentInput {
                hypothesis: Some("  h ".to_owned()),
                config: Some(config.clone()),
                ..input("x")
            },
            "i",
            "t",
        )
        .unwrap();
        assert_eq!(made.hypothesis.as_deref(), Some("  h "));
        assert_eq!(made.config, config);
    }

    #[test]
    fn unset_optionals_are_omitted_from_json() {
        let made = create_experiment(&input("x"), "i", "t").unwrap();
        let json = serde_json::to_value(&made).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("hypothesis"));
        assert!(!obj.contains_key("startedAt"));
        assert_eq!(obj["createdAt"], "t");
        assert_eq!(obj["status"], "planned");
    }
}

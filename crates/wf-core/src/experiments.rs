//! Metric point downsampling: keep every point below `KEEP_ALL_BELOW_STEP`, then halve the
//! sample rate once per octave of step. Keyed on `step` alone so ingest is idempotent.

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

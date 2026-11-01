//! Pins the metric downsampling rule: stride per octave, sampling grid, ingest plan and prune plan.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use wf_core::experiments::{
    KEEP_ALL_BELOW_STEP, is_on_sampling_grid, plan_series_ingest, steps_to_prune, stride_for_step,
};

#[test]
fn threshold_is_ten_thousand() {
    assert_eq!(KEEP_ALL_BELOW_STEP, 10_000.0);
}

#[test]
fn stride_doubles_once_per_octave() {
    assert_eq!(stride_for_step(9999.0), 1.0);
    assert_eq!(stride_for_step(10_000.0), 1.0);
    assert_eq!(stride_for_step(10_001.0), 2.0);
    assert_eq!(stride_for_step(20_000.0), 2.0);
    assert_eq!(stride_for_step(20_001.0), 4.0);
}

#[test]
fn stride_is_one_for_non_finite_steps() {
    assert_eq!(stride_for_step(f64::NAN), 1.0);
    assert_eq!(stride_for_step(f64::INFINITY), 1.0);
}

#[test]
fn grid_membership() {
    assert!(is_on_sampling_grid(0.0));
    assert!(is_on_sampling_grid(-5.0));
    assert!(!is_on_sampling_grid(f64::NAN));
    assert!(!is_on_sampling_grid(f64::INFINITY));
    assert!(!is_on_sampling_grid(10_001.0));
    assert!(is_on_sampling_grid(10_002.0));
    assert!(!is_on_sampling_grid(20_002.0));
    assert!(is_on_sampling_grid(20_004.0));
}

#[test]
fn plan_keeps_grid_points_and_newest() {
    let steps = [10_001.0, 10_002.0, 10_003.0];
    let decision = plan_series_ingest(&steps, None);
    assert_eq!(decision.keep, vec![1, 2]);
    assert_eq!(decision.superseded_tip_step, None);
}

#[test]
fn plan_supersedes_previous_off_grid_tip() {
    let steps = [10_001.0, 10_002.0, 10_003.0];
    let decision = plan_series_ingest(&steps, Some(10_001.0));
    assert_eq!(decision.superseded_tip_step, Some(10_001.0));
}

#[test]
fn plan_does_not_supersede_on_grid_or_newer_previous() {
    let steps = [10_001.0, 10_002.0, 10_003.0];
    assert_eq!(
        plan_series_ingest(&steps, Some(10_002.0)).superseded_tip_step,
        None
    );
    assert_eq!(
        plan_series_ingest(&steps, Some(10_003.0)).superseded_tip_step,
        None
    );
    assert_eq!(
        plan_series_ingest(&steps, Some(20_000.0)).superseded_tip_step,
        None
    );
}

#[test]
fn plan_keeps_duplicate_newest_steps() {
    let decision = plan_series_ingest(&[5.0, 5.0], None);
    assert_eq!(decision.keep, vec![0, 1]);
}

#[test]
fn plan_empty_batch() {
    let decision = plan_series_ingest(&[], Some(10_001.0));
    assert!(decision.keep.is_empty());
    assert_eq!(decision.superseded_tip_step, None);
}

#[test]
fn prune_drops_off_grid_steps_except_newest() {
    assert_eq!(
        steps_to_prune(&[10_001.0, 10_002.0, 10_003.0]),
        vec![10_001.0]
    );
}

#[test]
fn prune_empty_and_single_newest() {
    assert!(steps_to_prune(&[]).is_empty());
    assert!(steps_to_prune(&[10_003.0]).is_empty());
}

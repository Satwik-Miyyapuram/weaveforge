//! Blob content types and eviction scoring, matching
//! `packages/core/src/storage/blob-content-type.ts` and
//! `packages/core/src/storage/blob-tiering.ts`, with cases from
//! `packages/core/test/storage/blob-tiering.test.ts` and the `types` section of
//! `goldens/sync-leaf.json`.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use proptest::prelude::*;
use wf_core::storage::blob::{
    BlobObjectRecord, BlobTier, BlobTieringWeights, compute_blob_eviction_score,
    guess_blob_content_type, rank_for_eviction,
};

/// 2026-01-01T00:00:00Z in epoch ms.
const JAN_1_2026: i64 = 1_767_225_600_000;
/// 2026-04-01T00:00:00Z in epoch ms.
const APR_1_2026: i64 = 1_775_001_600_000;
/// 2026-07-10T00:00:00Z in epoch ms.
const JUL_10_2026: i64 = 1_783_641_600_000;
/// 2026-07-11T12:00:00Z in epoch ms, the TS test's `now`.
const NOW: i64 = 1_783_771_200_000;

fn golden() -> serde_json::Value {
    serde_json::from_str(include_str!("goldens/sync-leaf.json")).expect("golden parses")
}

fn rec(
    path: &str,
    access_count: f64,
    priority: f64,
    last_accessed_at: Option<i64>,
) -> BlobObjectRecord {
    BlobObjectRecord {
        bucket: "b".to_owned(),
        path: path.to_owned(),
        tier: BlobTier::Hot,
        size_bytes: 1000.0,
        access_count,
        last_accessed_at,
        priority,
        created_at: JAN_1_2026,
    }
}

// --- golden `types` section ---

#[test]
fn golden_types_match() {
    let g = golden();
    let cases = g["types"].as_array().expect("types array");
    assert!(!cases.is_empty());
    for case in cases {
        let path = case["path"].as_str().expect("path");
        let out = case["out"].as_str().expect("out");
        assert_eq!(guess_blob_content_type(path), out, "case {path:?}");
    }
}

#[test]
fn content_type_ignores_case_and_takes_last_dot_segment() {
    assert_eq!(guess_blob_content_type("A.PNG"), "image/png");
    assert_eq!(
        guess_blob_content_type("x.tar.gz"),
        "application/octet-stream"
    );
    assert_eq!(
        guess_blob_content_type("dir.v/file"),
        "application/octet-stream"
    );
}

// --- ported blob-tiering.test.ts ---

#[test]
fn ranks_idle_low_priority_objects_highest() {
    let old_done = rec("u/e/plot.png", 2.0, 20.0, Some(APR_1_2026));
    let active = rec("u/e/live.png", 40.0, 70.0, Some(JUL_10_2026));
    assert!(
        compute_blob_eviction_score(&old_done, NOW, None)
            > compute_blob_eviction_score(&active, NOW, None)
    );
}

#[test]
fn rank_for_eviction_orders_descending_by_score() {
    let a = rec("a", 0.0, 20.0, Some(JAN_1_2026));
    let b = rec("b", 0.0, 80.0, Some(JUL_10_2026));
    let records = [b, a];
    let ranked = rank_for_eviction(&records, NOW, None);
    assert_eq!(ranked.first().map(|r| r.path.as_str()), Some("a"));
}

// --- scoring details ---

#[test]
fn falls_back_to_created_at_when_never_accessed() {
    let never = rec("n", 0.0, 50.0, None);
    let touched = rec("t", 0.0, 50.0, Some(NOW));
    let idle = compute_blob_eviction_score(&never, NOW, None);
    let fresh = compute_blob_eviction_score(&touched, NOW, None);
    // created 2026-01-01 is ~191.5 days before NOW.
    assert!(
        (idle - fresh - 191.5).abs() < 1e-6,
        "idle={idle} fresh={fresh}"
    );
}

#[test]
fn default_weights_are_alpha_1_beta_30_gamma_half() {
    let w = BlobTieringWeights::default();
    assert!((w.alpha - 1.0).abs() < f64::EPSILON);
    assert!((w.beta - 30.0).abs() < f64::EPSILON);
    assert!((w.gamma - 0.5).abs() < f64::EPSILON);
}

#[test]
fn none_weights_equal_explicit_defaults() {
    let r = rec("r", 3.0, 40.0, Some(JUL_10_2026));
    let d = BlobTieringWeights::default();
    assert!(
        (compute_blob_eviction_score(&r, NOW, None)
            - compute_blob_eviction_score(&r, NOW, Some(&d)))
        .abs()
            < f64::EPSILON
    );
}

#[test]
fn future_last_access_counts_as_zero_idle_days() {
    let future = rec("f", 0.0, 100.0, Some(NOW + 86_400_000));
    let now_touch = rec("n", 0.0, 100.0, Some(NOW));
    assert!(
        (compute_blob_eviction_score(&future, NOW, None)
            - compute_blob_eviction_score(&now_touch, NOW, None))
        .abs()
            < f64::EPSILON
    );
}

#[test]
fn custom_weights_scale_each_term() {
    let r = rec("w", 0.0, 100.0, Some(NOW - 2 * 86_400_000));
    let w = BlobTieringWeights {
        alpha: 10.0,
        beta: 0.0,
        gamma: 0.0,
    };
    let score = compute_blob_eviction_score(&r, NOW, Some(&w));
    assert!((score - 20.0).abs() < 1e-9, "score={score}");
}

#[test]
fn rank_for_eviction_on_empty_is_empty() {
    assert!(rank_for_eviction(&[], NOW, None).is_empty());
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn score_never_decreases_as_idle_days_grow(
        last in 0i64..1_900_000_000_000,
        dt in 0i64..1_000_000_000_000,
        access in 0u32..1000,
        priority in 0u32..=100,
    ) {
        let r = rec("p", f64::from(access), f64::from(priority), Some(last));
        let earlier = compute_blob_eviction_score(&r, last, None);
        let later = compute_blob_eviction_score(&r, last + dt, None);
        prop_assert!(later >= earlier, "earlier={earlier} later={later}");
    }

    #[test]
    fn ranking_is_a_permutation_sorted_by_score_desc(
        specs in proptest::collection::vec((0u32..500, 0u32..=100, proptest::option::of(0i64..1_900_000_000_000)), 0..24),
    ) {
        let records: Vec<BlobObjectRecord> = specs
            .iter()
            .enumerate()
            .map(|(i, (access, prio, last))| {
                rec(&format!("p{i}"), f64::from(*access), f64::from(*prio), *last)
            })
            .collect();
        let ranked = rank_for_eviction(&records, NOW, None);

        prop_assert_eq!(ranked.len(), records.len());
        let mut in_paths: Vec<&str> = records.iter().map(|r| r.path.as_str()).collect();
        let mut out_paths: Vec<&str> = ranked.iter().map(|r| r.path.as_str()).collect();
        in_paths.sort_unstable();
        out_paths.sort_unstable();
        prop_assert_eq!(in_paths, out_paths);

        let scores: Vec<f64> = ranked
            .iter()
            .map(|r| compute_blob_eviction_score(r, NOW, None))
            .collect();
        for pair in scores.windows(2) {
            prop_assert!(pair[0] >= pair[1], "not desc: {pair:?}");
        }
    }
}

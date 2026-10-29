//! Reciprocal rank fusion, matching `fuseRankings` in
//! `packages/core/src/search/rank-fusion.ts` except that ties break on code
//! point order of the id instead of `localeCompare`.

use std::num::NonZeroUsize;

use proptest::prelude::*;
use wf_core::search::fusion::{RRF_K, RankedList, fuse_rankings};

fn list(ids: &[&str], weight: f64) -> RankedList {
    RankedList {
        ids: ids.iter().map(|id| (*id).to_owned()).collect(),
        weight,
    }
}

fn fuse(lists: &[RankedList]) -> Vec<String> {
    fuse_rankings(lists, RRF_K, None)
}

#[test]
fn rrf_k_is_the_paper_value() {
    assert_eq!(RRF_K, 60);
}

#[test]
fn no_lists_or_empty_lists_give_nothing() {
    assert!(fuse(&[]).is_empty());
    assert!(fuse(&[list(&[], 1.0), list(&[], 1.0)]).is_empty());
}

#[test]
fn a_single_list_keeps_its_order() {
    assert_eq!(fuse(&[list(&["c", "a", "b"], 1.0)]), ["c", "a", "b"]);
}

#[test]
fn an_id_both_arms_rank_beats_ids_only_one_arm_found() {
    // b: 1/62 + 1/62 beats a: 1/61 and d: 1/61.
    let fused = fuse(&[list(&["a", "b"], 1.0), list(&["d", "b"], 1.0)]);
    assert_eq!(fused, ["b", "a", "d"]);
}

#[test]
fn equal_scores_break_on_id_order() {
    assert_eq!(fuse(&[list(&["z"], 1.0), list(&["m"], 1.0)]), ["m", "z"]);
    // Code point order: uppercase sorts before lowercase.
    assert_eq!(fuse(&[list(&["b"], 1.0), list(&["B"], 1.0)]), ["B", "b"]);
}

#[test]
fn weight_scales_an_arm() {
    // a: 1/61; d: 3/61.
    assert_eq!(fuse(&[list(&["a"], 1.0), list(&["d"], 3.0)]), ["d", "a"]);
    // Zero weight still includes the id, ranked last.
    assert_eq!(fuse(&[list(&["a"], 0.0), list(&["d"], 1.0)]), ["d", "a"]);
}

#[test]
fn k_flattens_the_top_positions() {
    // b is third in both arms; a and q are first in one each.
    let lists = [list(&["a", "p", "b"], 1.0), list(&["q", "r", "b"], 1.0)];
    // k = 0: a = q = 1/1 beat b = 2/3.
    assert_eq!(fuse_rankings(&lists, 0, None), ["a", "q", "b", "p", "r"]);
    // k = 60: b = 2/63 beats a = q = 1/61.
    assert_eq!(
        fuse_rankings(&lists, RRF_K, None),
        ["b", "a", "q", "p", "r"]
    );
}

#[test]
fn a_duplicate_inside_one_list_adds_both_positions() {
    // TS adds every occurrence: a = 1/61 + 1/63 beats b = 1/62 + 0.
    assert_eq!(fuse(&[list(&["a", "b", "a"], 1.0)]), ["a", "b"]);
}

#[test]
fn limit_truncates_after_sorting() {
    let lists = [list(&["a", "b", "c"], 1.0)];
    let two = NonZeroUsize::new(2);
    assert_eq!(fuse_rankings(&lists, RRF_K, two), ["a", "b"]);
    let many = NonZeroUsize::new(10);
    assert_eq!(fuse_rankings(&lists, RRF_K, many), ["a", "b", "c"]);
}

proptest! {
    #[test]
    fn output_is_the_distinct_input_ids(
        a in proptest::collection::vec("[a-e]{1,2}", 0..12),
        b in proptest::collection::vec("[a-e]{1,2}", 0..12),
        weight in 0.0f64..5.0,
    ) {
        let refs_a: Vec<&str> = a.iter().map(String::as_str).collect();
        let refs_b: Vec<&str> = b.iter().map(String::as_str).collect();
        let fused = fuse(&[list(&refs_a, 1.0), list(&refs_b, weight)]);
        let mut expected: Vec<String> = a.iter().chain(&b).cloned().collect();
        expected.sort();
        expected.dedup();
        let mut got = fused.clone();
        got.sort();
        prop_assert_eq!(got, expected);
    }
}

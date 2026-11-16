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

/// Runs of two-letter ids as (start, step, count), with `aa` = 0 and
/// wrapping after `zz` = 675, so a long list needs no long literal.
fn stride(runs: &[(usize, usize, usize)], weight: f64) -> RankedList {
    let letter = |n: usize| char::from(b'a' + u8::try_from(n).unwrap_or(0));
    let ids = runs
        .iter()
        .flat_map(|&(start, step, count)| (0..count).map(move |k| (start + step * k) % 676))
        .map(|n| [letter(n / 26), letter(n % 26)].iter().collect())
        .collect();
    RankedList { ids, weight }
}

/// Lists as (ids, weight), k, limit (0 is no limit, as the WASM binding reads
/// it), fused ids.
type FusionCase = (
    &'static [(&'static [&'static str], f64)],
    u32,
    usize,
    &'static [&'static str],
);

/// The ids are lowercase ASCII, so code point ties order like the TypeScript did.
const CASES: &[FusionCase] = &[
    (&[], RRF_K, 0, &[]),
    (&[(&[], 1.0), (&[], 1.0)], RRF_K, 0, &[]),
    (
        &[(&["aa", "ab", "ac"], 1.0), (&["ac", "aa"], 1.0)],
        RRF_K,
        0,
        &["aa", "ac", "ab"],
    ),
    (
        &[(&["xa", "ya"], 0.0), (&["ya", "xa"], 1.0)],
        RRF_K,
        0,
        &["ya", "xa"],
    ),
    (
        &[(&["xa", "ya"], 2.0), (&["ya", "xa"], 1.0)],
        RRF_K,
        0,
        &["xa", "ya"],
    ),
    (
        &[(&["xa", "ya"], 0.5), (&["ya", "xa"], 1.25)],
        RRF_K,
        0,
        &["ya", "xa"],
    ),
    (
        &[(&["aa", "ab"], 1.0), (&["ac", "ad", "ab"], 1.0)],
        0,
        0,
        &["aa", "ac", "ab", "ad"],
    ),
    (
        &[(&["aa", "ab"], 1.0), (&["ac", "ad", "ab"], 1.0)],
        1000,
        0,
        &["ab", "aa", "ac", "ad"],
    ),
    (&[(&["aa", "ab", "ac"], 1.0)], RRF_K, 2, &["aa", "ab"]),
    (&[(&["aa", "ab", "ac"], 1.0)], RRF_K, 0, &["aa", "ab", "ac"]),
    (
        &[(&["aa", "ab", "ac"], 1.0)],
        RRF_K,
        10,
        &["aa", "ab", "ac"],
    ),
    (
        &[(&["aa", "ab", "aa", "aa"], 1.0), (&["ab"], 1.0)],
        RRF_K,
        0,
        &["aa", "ab"],
    ),
    (
        &[
            (&["ma"], 1.0),
            (&["ka"], 1.0),
            (&["za"], 1.0),
            (&["ab"], 1.0),
        ],
        RRF_K,
        0,
        &["ab", "ka", "ma", "za"],
    ),
    (
        &[(&["ca", "ba"], 1.0), (&["ba", "ca"], 1.0)],
        RRF_K,
        0,
        &["ba", "ca"],
    ),
];

#[test]
fn every_case_matches_the_typescript() {
    for (lists, k, limit, want) in CASES {
        let lists: Vec<RankedList> = lists
            .iter()
            .map(|(ids, weight)| list(ids, *weight))
            .collect();
        assert_eq!(
            fuse_rankings(&lists, *k, NonZeroUsize::new(*limit)),
            *want,
            "fuse {lists:?} k {k} limit {limit}"
        );
    }
}

/// Lists of 60, 80 and 40 ids (the second runs the first backwards, then adds
/// 20; the third is weighted 0.75), then a cut to 25 of 350 ids with k 7, as
/// the TypeScript fused them.
#[test]
fn long_lists_match_the_typescript() {
    let lists = [
        stride(&[(0, 1, 60)], 1.0),
        stride(&[(59, 675, 60), (100, 3, 20)], 1.0),
        stride(&[(5, 7, 40)], 0.75),
    ];
    let want: &[&str] = &[
        "af", "am", "cc", "at", "bv", "ba", "bo", "bh", "aa", "ch", "ab", "cg", "ac", "cf", "ad",
        "ce", "ae", "cd", "ag", "cb", "ah", "ca", "ai", "bz", "aj", "by", "ak", "bx", "al", "bw",
        "an", "bu", "ao", "bt", "ap", "bs", "aq", "br", "ar", "bq", "as", "bp", "au", "bn", "av",
        "bm", "aw", "bl", "ax", "bk", "ay", "bj", "az", "bi", "bb", "bg", "bc", "bf", "bd", "be",
        "dz", "eu", "fp", "cj", "cq", "cx", "de", "dl", "ds", "eg", "en", "fb", "fi", "fw", "gd",
        "gk", "gr", "gy", "hf", "hm", "ht", "ia", "dw", "ih", "io", "ec", "ef", "iv", "ei", "jc",
        "el", "jj", "eo", "er", "jq", "jx", "ex", "ke", "fa", "fd", "kl", "fg", "ks", "fj", "fm",
        "fs", "fv", "fy", "gb",
    ];
    assert_eq!(fuse_rankings(&lists, RRF_K, None), want);

    let lists = [stride(&[(0, 13, 200)], 1.0), stride(&[(3, 11, 150)], 1.0)];
    let want: &[&str] = &[
        "dn", "aa", "an", "ba", "ad", "bn", "ca", "ao", "cn", "da", "az", "ja", "fa", "ea", "bk",
        "en", "bv", "gn", "fn", "ga", "cg", "on", "ha", "cr", "kn",
    ];
    assert_eq!(fuse_rankings(&lists, 7, NonZeroUsize::new(25)), want);
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

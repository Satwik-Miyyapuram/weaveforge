//! Golden, ported and property tests for the body diff and conflict markers.
//! Goldens were printed by `packages/core/src/workspace/text-diff.ts` through
//! `node crates/wf-core/tests/goldens/sync-text.mjs`; ported cases come from
//! `packages/core/test/workspace/text-diff.test.ts`.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;

use proptest::prelude::*;
use serde_json::Value;
use wf_core::sync::text_diff::{
    BodyDiff, DiffHunk, DiffLine, DiffOp, HunkPick, MARKER_OURS, MARKER_SEPARATOR, MARKER_THEIRS,
    diff_body, has_conflict_markers, merge_hunks, write_conflict_markers,
};

const GOLDEN: &str = include_str!("goldens/sync-text-diff.json");

const OURS: &str = "# Method\n\nWe ran three seeds.\nThe effect held.\n";
const THEIRS: &str = "# Method\n\nWe ran five seeds.\nThe effect held.\nIt was smaller.\n";

fn golden() -> Value {
    serde_json::from_str(GOLDEN).expect("golden parses")
}

fn op_of(s: &str) -> DiffOp {
    match s {
        "same" => DiffOp::Same,
        "ours" => DiffOp::Ours,
        "theirs" => DiffOp::Theirs,
        other => panic!("unknown op {other:?}"),
    }
}

fn pick_of(s: &str) -> HunkPick {
    match s {
        "ours" => HunkPick::Ours,
        "theirs" => HunkPick::Theirs,
        "both" => HunkPick::Both,
        other => panic!("unknown pick {other:?}"),
    }
}

fn line_of(v: &Value) -> DiffLine {
    DiffLine {
        op: op_of(v["op"].as_str().expect("op")),
        text: v["text"].as_str().expect("text").to_owned(),
    }
}

fn lines_of(v: &Value) -> Vec<DiffLine> {
    v.as_array().expect("lines").iter().map(line_of).collect()
}

fn strings_of(v: &Value) -> Vec<String> {
    v.as_array()
        .expect("strings")
        .iter()
        .map(|s| s.as_str().expect("string").to_owned())
        .collect()
}

fn hunks_of(v: &Value) -> Vec<DiffHunk> {
    v.as_array()
        .expect("hunks")
        .iter()
        .map(|h| DiffHunk {
            index: usize::try_from(h["index"].as_u64().expect("index")).expect("usize"),
            ours: strings_of(&h["ours"]),
            theirs: strings_of(&h["theirs"]),
        })
        .collect()
}

fn picks_of(v: &Value) -> BTreeMap<usize, HunkPick> {
    v.as_object()
        .expect("picks")
        .iter()
        .map(|(k, p)| {
            (
                k.parse::<usize>().expect("hunk index"),
                pick_of(p.as_str().expect("pick")),
            )
        })
        .collect()
}

fn body_of(ours: &str, theirs: &str) -> BodyDiff {
    diff_body(ours, theirs)
}

#[test]
fn golden_diff_cases_match_typescript() {
    let golden = golden();
    let cases = golden["diff"].as_array().expect("diff");
    assert_eq!(cases.len(), 19, "golden case count");
    for case in cases {
        let ours = case["ours"].as_str().expect("ours");
        let theirs = case["theirs"].as_str().expect("theirs");
        let case_name = format!("{ours:?} / {theirs:?}");

        let body = body_of(ours, theirs);
        assert_eq!(
            body.lines,
            lines_of(&case["body"]["lines"]),
            "lines for {case_name}"
        );
        assert_eq!(
            body.hunks,
            hunks_of(&case["body"]["hunks"]),
            "hunks for {case_name}"
        );

        for pair in case["merged"].as_array().expect("merged") {
            let picks = picks_of(&pair[0]);
            let want = pair[1].as_str().expect("merged text");
            assert_eq!(
                merge_hunks(ours, theirs, &picks),
                want,
                "merge {picks:?} for {case_name}"
            );
        }

        assert_eq!(
            write_conflict_markers(ours, theirs),
            case["markers"].as_str().expect("markers"),
            "markers for {case_name}"
        );
    }
}

#[test]
fn golden_ceiling_case_matches_typescript() {
    let golden = golden();
    let want = &golden["ceiling"];
    let big = (0..2001)
        .map(|i| format!("o{i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let big2 = (0..2000)
        .map(|i| {
            if i == 7 {
                "o7".to_owned()
            } else {
                format!("t{i}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    let body = body_of(&big, &big2);
    assert_eq!(
        u64::try_from(body.hunks.len()).expect("len"),
        want["hunks"].as_u64().expect("hunks"),
        "ceiling hunk count"
    );
    assert_eq!(
        u64::try_from(body.lines.len()).expect("len"),
        want["lines"].as_u64().expect("lines"),
        "ceiling line count"
    );
    assert_eq!(
        body.lines.first(),
        Some(&line_of(&want["oursFirst"])),
        "ceiling first line"
    );
}

#[test]
fn golden_has_markers_cases_match_typescript() {
    let golden = golden();
    let cases = golden["hasMarkers"].as_array().expect("hasMarkers");
    assert_eq!(cases.len(), 14, "golden case count");
    for pair in cases {
        let text = pair[0].as_str().expect("text");
        let want = pair[1].as_bool().expect("bool");
        assert_eq!(has_conflict_markers(text), want, "hasMarkers for {text:?}");
    }
}

#[test]
fn a_body_diff_is_hunks_of_disagreeing_lines() {
    let BodyDiff { lines, hunks } = body_of(OURS, THEIRS);

    assert_eq!(hunks.len(), 2);
    assert_eq!(hunks[0].ours, ["We ran three seeds."]);
    assert_eq!(hunks[0].theirs, ["We ran five seeds."]);
    assert!(hunks[1].ours.is_empty());
    assert_eq!(hunks[1].theirs, ["It was smaller."]);
    assert!(
        lines
            .iter()
            .any(|l| l.op == DiffOp::Same && l.text == "# Method")
    );
}

#[test]
fn taking_one_hunk_leaves_the_other_as_ours() {
    let picks = BTreeMap::from([(0, HunkPick::Theirs)]);
    let merged = merge_hunks(OURS, THEIRS, &picks);

    assert!(merged.contains("We ran five seeds."));
    assert!(!merged.contains("It was smaller."));
    assert!(merged.ends_with("We ran five seeds.\nThe effect held.\n"));
}

#[test]
fn an_unchosen_hunk_keeps_ours_and_both_keeps_both() {
    assert_eq!(merge_hunks(OURS, THEIRS, &BTreeMap::new()), OURS);
    let both = merge_hunks(OURS, THEIRS, &BTreeMap::from([(0, HunkPick::Both)]));
    assert!(both.contains("We ran three seeds.\nWe ran five seeds."));
}

#[test]
fn a_body_neither_side_touched_has_no_hunks() {
    assert!(body_of(OURS, OURS).hunks.is_empty());
    assert_eq!(merge_hunks(OURS, OURS, &BTreeMap::new()), OURS);
}

#[test]
fn markers_wrap_only_conflicting_hunks() {
    let marked = write_conflict_markers(OURS, THEIRS);

    assert!(marked.starts_with(
        "# Method\n\n<<<<<<< this app\nWe ran three seeds.\n=======\nWe ran five seeds.\n>>>>>>> the folder"
    ));
    assert!(marked.contains(">>>>>>> the folder\nThe effect held.\n"));
    assert!(has_conflict_markers(&marked));
    assert!(marked.contains("We ran three seeds."));
    assert!(marked.contains("We ran five seeds."));
}

#[test]
fn markers_wrap_the_entire_body_when_nothing_agrees() {
    let marked = write_conflict_markers("All ours", "All theirs");
    assert_eq!(
        marked,
        format!("{MARKER_OURS}\nAll ours\n{MARKER_SEPARATOR}\nAll theirs\n{MARKER_THEIRS}")
    );
    assert!(has_conflict_markers(&marked));
}

#[test]
fn detects_git_conflict_markers_as_well_as_app_markers() {
    let git = "<<<<<<< HEAD\nours from git\n=======\ntheirs from git\n>>>>>>> branch";
    assert!(has_conflict_markers(git));

    let short = "<<<<<<<\nfoo\n=======\nbar\n>>>>>>>";
    assert!(has_conflict_markers(short));
}

#[test]
fn crlf_line_endings_normalise_without_false_changes() {
    let ours = "# Title\r\n\r\nParagraph 1.\r\n";
    assert!(
        body_of(ours, "# Title\r\n\r\nParagraph 1.\r\n")
            .hunks
            .is_empty()
    );

    let body = body_of(ours, "# Title\r\n\r\nParagraph 2.\r\n");
    assert_eq!(body.hunks.len(), 1);
    assert_eq!(body.hunks[0].ours, ["Paragraph 1."]);
    assert_eq!(body.hunks[0].theirs, ["Paragraph 2."]);
}

#[test]
fn a_setext_heading_is_not_a_conflict_marker() {
    assert!(!has_conflict_markers("Chapter 3\n=======\nBody text.\n"));
    assert!(!has_conflict_markers(&format!("text\n{MARKER_THEIRS}\n")));
}

fn text_strategy() -> impl Strategy<Value = String> {
    prop::collection::vec(prop::sample::select(vec!["a", "b", "c", ""]), 0..8)
        .prop_map(|lines| lines.join("\n"))
}

fn normalise(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn all_picks(ours: &str, theirs: &str, pick: HunkPick) -> BTreeMap<usize, HunkPick> {
    body_of(ours, theirs)
        .hunks
        .iter()
        .map(|h| (h.index, pick))
        .collect()
}

fn is_marker(line: &str) -> bool {
    line == MARKER_OURS || line == MARKER_SEPARATOR || line == MARKER_THEIRS
}

fn counts(lines: &[&str]) -> BTreeMap<String, usize> {
    let mut map = BTreeMap::new();
    for line in lines {
        *map.entry((*line).to_owned()).or_insert(0) += 1;
    }
    map
}

proptest! {
    #![proptest_config(ProptestConfig::default())]

    #[test]
    fn all_ours_picks_merge_to_ours(ours in text_strategy(), theirs in text_strategy()) {
        let picks = all_picks(&ours, &theirs, HunkPick::Ours);
        prop_assert_eq!(merge_hunks(&ours, &theirs, &picks), normalise(&ours));
    }

    #[test]
    fn all_theirs_picks_merge_to_theirs(ours in text_strategy(), theirs in text_strategy()) {
        let picks = all_picks(&ours, &theirs, HunkPick::Theirs);
        prop_assert_eq!(merge_hunks(&ours, &theirs, &picks), normalise(&theirs));
    }

    #[test]
    fn markers_keep_every_ours_and_theirs_line(ours in text_strategy(), theirs in text_strategy()) {
        let marked = write_conflict_markers(&ours, &theirs);
        let kept: Vec<&str> = marked.split('\n').filter(|l| !is_marker(l)).collect();
        let kept_counts = counts(&kept);

        for side in [&ours, &theirs] {
            let side_lines: Vec<&str> = side.split('\n').collect();
            for (line, want) in counts(&side_lines) {
                let got = kept_counts.get(&line).copied().unwrap_or(0);
                prop_assert!(got >= want, "line {:?} wanted {} got {} in {:?}", line, want, got, marked);
            }
        }
    }

    #[test]
    fn differing_sides_always_write_detectable_markers(ours in text_strategy(), theirs in text_strategy()) {
        prop_assume!(ours != theirs);
        prop_assert!(has_conflict_markers(&write_conflict_markers(&ours, &theirs)));
    }
}

//! Table, ported and property tests for the body diff and conflict markers.
//! The tables keep every case the old TypeScript-printed golden of
//! `packages/core/src/workspace/text-diff.ts` covered; ported cases come from
//! `packages/core/test/workspace/text-diff.test.ts`.

// The diff-line helper sits outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::panic)]

use std::collections::BTreeMap;

use proptest::prelude::*;
use wf_core::sync::text_diff::{
    BodyDiff, DiffHunk, DiffLine, DiffOp, HunkPick, MARKER_OURS, MARKER_SEPARATOR, MARKER_THEIRS,
    diff_body, has_conflict_markers, merge_hunks, write_conflict_markers,
};

const OURS: &str = "# Method\n\nWe ran three seeds.\nThe effect held.\n";
const THEIRS: &str = "# Method\n\nWe ran five seeds.\nThe effect held.\nIt was smaller.\n";

/// One diff of `ours` against `theirs`. `lines` reads like a unified diff:
/// `" "` same, `"-"` ours only, `"+"` theirs only. `hunks` holds each hunk's
/// ours and theirs lines in index order. `merged` is `merge_hunks` under each
/// entry of [`PICKS`].
struct DiffCase {
    ours: &'static str,
    theirs: &'static str,
    lines: &'static [&'static str],
    hunks: &'static [(&'static [&'static str], &'static [&'static str])],
    merged: [&'static str; 6],
    markers: &'static str,
}

/// Hunk choices tried on every case; out-of-range indexes are ignored.
const PICKS: [&[(usize, HunkPick)]; 6] = [
    &[],
    &[(0, HunkPick::Theirs)],
    &[(0, HunkPick::Both)],
    &[(0, HunkPick::Ours), (1, HunkPick::Theirs)],
    &[(1, HunkPick::Both)],
    &[(5, HunkPick::Theirs)],
];

const DIFF_CASES: &[DiffCase] = &[
    DiffCase {
        ours: "",
        theirs: "",
        lines: &[" "],
        hunks: &[],
        merged: ["", "", "", "", "", ""],
        markers: "",
    },
    DiffCase {
        ours: "a",
        theirs: "",
        lines: &["-a", "+"],
        hunks: &[(&["a"], &[""])],
        merged: ["a", "", "a\n", "a", "a", "a"],
        markers: "<<<<<<< this app\na\n=======\n\n>>>>>>> the folder",
    },
    DiffCase {
        ours: "",
        theirs: "a",
        lines: &["-", "+a"],
        hunks: &[(&[""], &["a"])],
        merged: ["", "a", "\na", "", "", ""],
        markers: "<<<<<<< this app\n\n=======\na\n>>>>>>> the folder",
    },
    DiffCase {
        ours: "a",
        theirs: "a",
        lines: &[" a"],
        hunks: &[],
        merged: ["a", "a", "a", "a", "a", "a"],
        markers: "a",
    },
    DiffCase {
        ours: "a\nb\nc",
        theirs: "a\nb\nc",
        lines: &[" a", " b", " c"],
        hunks: &[],
        merged: [
            "a\nb\nc", "a\nb\nc", "a\nb\nc", "a\nb\nc", "a\nb\nc", "a\nb\nc",
        ],
        markers: "a\nb\nc",
    },
    DiffCase {
        ours: "a\nb\nc",
        theirs: "a\nx\nc",
        lines: &[" a", "-b", "+x", " c"],
        hunks: &[(&["b"], &["x"])],
        merged: [
            "a\nb\nc",
            "a\nx\nc",
            "a\nb\nx\nc",
            "a\nb\nc",
            "a\nb\nc",
            "a\nb\nc",
        ],
        markers: "a\n<<<<<<< this app\nb\n=======\nx\n>>>>>>> the folder\nc",
    },
    DiffCase {
        ours: "a\nb\nc",
        theirs: "a\nc",
        lines: &[" a", "-b", " c"],
        hunks: &[(&["b"], &[])],
        merged: [
            "a\nb\nc", "a\nc", "a\nb\nc", "a\nb\nc", "a\nb\nc", "a\nb\nc",
        ],
        markers: "a\n<<<<<<< this app\nb\n=======\n>>>>>>> the folder\nc",
    },
    DiffCase {
        ours: "a\nc",
        theirs: "a\nb\nc",
        lines: &[" a", "+b", " c"],
        hunks: &[(&[], &["b"])],
        merged: ["a\nc", "a\nb\nc", "a\nb\nc", "a\nc", "a\nc", "a\nc"],
        markers: "a\n<<<<<<< this app\n=======\nb\n>>>>>>> the folder\nc",
    },
    DiffCase {
        ours: "a\r\nb\r\nc",
        theirs: "a\nb\nc",
        lines: &[" a", " b", " c"],
        hunks: &[],
        merged: [
            "a\nb\nc", "a\nb\nc", "a\nb\nc", "a\nb\nc", "a\nb\nc", "a\nb\nc",
        ],
        markers: "a\r\nb\r\nc",
    },
    DiffCase {
        ours: "a\rb",
        theirs: "a\nb",
        lines: &[" a", " b"],
        hunks: &[],
        merged: ["a\nb", "a\nb", "a\nb", "a\nb", "a\nb", "a\nb"],
        markers: "a\rb",
    },
    DiffCase {
        ours: "x\ny",
        theirs: "p\nq",
        lines: &["-x", "-y", "+p", "+q"],
        hunks: &[(&["x", "y"], &["p", "q"])],
        merged: ["x\ny", "p\nq", "x\ny\np\nq", "x\ny", "x\ny", "x\ny"],
        markers: "<<<<<<< this app\nx\ny\n=======\np\nq\n>>>>>>> the folder",
    },
    DiffCase {
        ours: "a\nb\nc\nd\ne",
        theirs: "a\nB\nc\nD\ne",
        lines: &[" a", "-b", "+B", " c", "-d", "+D", " e"],
        hunks: &[(&["b"], &["B"]), (&["d"], &["D"])],
        merged: [
            "a\nb\nc\nd\ne",
            "a\nB\nc\nd\ne",
            "a\nb\nB\nc\nd\ne",
            "a\nb\nc\nD\ne",
            "a\nb\nc\nd\nD\ne",
            "a\nb\nc\nd\ne",
        ],
        markers: "a\n<<<<<<< this app\nb\n=======\nB\n>>>>>>> the folder\nc\n<<<<<<< this app\nd\n=======\nD\n>>>>>>> the folder\ne",
    },
    DiffCase {
        ours: "one\ntwo\nthree\n",
        theirs: "one\nthree\nfour\n",
        lines: &[" one", "-two", " three", "+four", " "],
        hunks: &[(&["two"], &[]), (&[], &["four"])],
        merged: [
            "one\ntwo\nthree\n",
            "one\nthree\n",
            "one\ntwo\nthree\n",
            "one\ntwo\nthree\nfour\n",
            "one\ntwo\nthree\nfour\n",
            "one\ntwo\nthree\n",
        ],
        markers: "one\n<<<<<<< this app\ntwo\n=======\n>>>>>>> the folder\nthree\n<<<<<<< this app\n=======\nfour\n>>>>>>> the folder\n",
    },
    DiffCase {
        ours: "same\n",
        theirs: "same",
        lines: &[" same", "-"],
        hunks: &[(&[""], &[])],
        merged: ["same\n", "same", "same\n", "same\n", "same\n", "same\n"],
        markers: "same\n<<<<<<< this app\n\n=======\n>>>>>>> the folder",
    },
    DiffCase {
        ours: "a\nb\na\nb",
        theirs: "b\na\nb\na",
        lines: &["-a", " b", " a", " b", "+a"],
        hunks: &[(&["a"], &[]), (&[], &["a"])],
        merged: [
            "a\nb\na\nb",
            "b\na\nb",
            "a\nb\na\nb",
            "a\nb\na\nb\na",
            "a\nb\na\nb\na",
            "a\nb\na\nb",
        ],
        markers: "<<<<<<< this app\na\n=======\n>>>>>>> the folder\nb\na\nb\n<<<<<<< this app\n=======\na\n>>>>>>> the folder",
    },
    DiffCase {
        ours: "a\n\n\nb",
        theirs: "a\nb",
        lines: &[" a", "-", "-", " b"],
        hunks: &[(&["", ""], &[])],
        merged: [
            "a\n\n\nb", "a\nb", "a\n\n\nb", "a\n\n\nb", "a\n\n\nb", "a\n\n\nb",
        ],
        markers: "a\n<<<<<<< this app\n\n\n=======\n>>>>>>> the folder\nb",
    },
    DiffCase {
        ours: "<<<<<<< this app\nx\n=======\ny\n>>>>>>> the folder",
        theirs: "z",
        lines: &[
            "-<<<<<<< this app",
            "-x",
            "-=======",
            "-y",
            "->>>>>>> the folder",
            "+z",
        ],
        hunks: &[(
            &[
                "<<<<<<< this app",
                "x",
                "=======",
                "y",
                ">>>>>>> the folder",
            ],
            &["z"],
        )],
        merged: [
            "<<<<<<< this app\nx\n=======\ny\n>>>>>>> the folder",
            "z",
            "<<<<<<< this app\nx\n=======\ny\n>>>>>>> the folder\nz",
            "<<<<<<< this app\nx\n=======\ny\n>>>>>>> the folder",
            "<<<<<<< this app\nx\n=======\ny\n>>>>>>> the folder",
            "<<<<<<< this app\nx\n=======\ny\n>>>>>>> the folder",
        ],
        markers: "<<<<<<< this app\n<<<<<<< this app\nx\n=======\ny\n>>>>>>> the folder\n=======\nz\n>>>>>>> the folder",
    },
    DiffCase {
        ours: "héllo\n日本",
        theirs: "hello\n日本",
        lines: &["-héllo", "+hello", " 日本"],
        hunks: &[(&["héllo"], &["hello"])],
        merged: [
            "héllo\n日本",
            "hello\n日本",
            "héllo\nhello\n日本",
            "héllo\n日本",
            "héllo\n日本",
            "héllo\n日本",
        ],
        markers: "<<<<<<< this app\nhéllo\n=======\nhello\n>>>>>>> the folder\n日本",
    },
    DiffCase {
        ours: "a\nb",
        theirs: "a\nb\n",
        lines: &[" a", " b", "+"],
        hunks: &[(&[], &[""])],
        merged: ["a\nb", "a\nb\n", "a\nb\n", "a\nb", "a\nb", "a\nb"],
        markers: "a\nb\n<<<<<<< this app\n=======\n\n>>>>>>> the folder",
    },
];

/// Reads one `lines` entry of a [`DiffCase`].
fn line(entry: &str) -> DiffLine {
    let (prefix, text) = entry.split_at(1);
    let op = match prefix {
        " " => DiffOp::Same,
        "-" => DiffOp::Ours,
        "+" => DiffOp::Theirs,
        other => panic!("unknown diff prefix {other:?}"),
    };
    DiffLine {
        op,
        text: text.to_owned(),
    }
}

fn body_of(ours: &str, theirs: &str) -> BodyDiff {
    diff_body(ours, theirs)
}

#[test]
fn diff_cases() {
    for case in DIFF_CASES {
        let (ours, theirs) = (case.ours, case.theirs);
        let case_name = format!("{ours:?} / {theirs:?}");

        let body = body_of(ours, theirs);
        let lines: Vec<DiffLine> = case.lines.iter().map(|l| line(l)).collect();
        assert_eq!(body.lines, lines, "lines for {case_name}");
        let hunks: Vec<DiffHunk> = case
            .hunks
            .iter()
            .enumerate()
            .map(|(index, (ours, theirs))| DiffHunk {
                index,
                ours: ours.iter().map(|s| (*s).to_owned()).collect(),
                theirs: theirs.iter().map(|s| (*s).to_owned()).collect(),
            })
            .collect();
        assert_eq!(body.hunks, hunks, "hunks for {case_name}");

        for (picks, want) in PICKS.iter().zip(case.merged) {
            let picks: BTreeMap<usize, HunkPick> = picks.iter().copied().collect();
            assert_eq!(
                merge_hunks(ours, theirs, &picks),
                want,
                "merge {picks:?} for {case_name}"
            );
        }

        assert_eq!(
            write_conflict_markers(ours, theirs),
            case.markers,
            "markers for {case_name}"
        );
    }
}

/// Past 4M cells the diff stops aligning: one hunk holds both copies whole.
#[test]
fn diff_past_the_ceiling_is_one_hunk() {
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
    assert_eq!(body.hunks.len(), 1, "ceiling hunk count");
    assert_eq!(body.lines.len(), 4001, "ceiling line count");
    assert_eq!(body.lines.first(), Some(&line("-o0")), "ceiling first line");
}

#[test]
fn has_markers_cases() {
    let cases = [
        ("", false),
        ("a", false),
        ("<<<<<<< this app\nx", false),
        ("<<<<<<< this app\nx\n>>>>>>> the folder", true),
        ("<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main", true),
        ("<<<<<<<\n>>>>>>>", true),
        ("<<<<<<<x\n>>>>>>>", false),
        ("<<<<<<< a\r\n>>>>>>> b", true),
        ("Title\n=======\n", false),
        (">>>>>>> x\n<<<<<<< y", false),
        ("  <<<<<<< x\n>>>>>>> y", false),
        ("<<<<<<<\t\n>>>>>>>\t", true),
        ("<<<<<<<< x\n>>>>>>>> y", false),
        ("<<<<<<< this appX\n>>>>>>> the folderY", true),
    ];
    for (text, want) in cases {
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

//! Screening decisions kept in the reading-list file (files-first L6).
//! Named cases from the plan, then the laws in `docs/building/core/reading-lists.md`.

use proptest::prelude::*;
use wf_core::reading_lists::list_file::{
    ListFileError, effective_decisions, list_decisions, mark_missing, read_list_file,
    record_decision, remove_decision,
};
use wf_core::reading_lists::screening::{ScreeningDecision, ScreeningStage, ScreeningState};

const LIST: &str = "---\nwf: 3\nweaveforge-id: list-1\ntitle: \"Review: LLMs\"\ncolor: blue\n---\nWhat this list is for.\n";

fn decision(id: &str, item: &str, state: ScreeningState, at: &str) -> ScreeningDecision {
    ScreeningDecision {
        id: id.to_owned(),
        item_id: item.to_owned(),
        reviewer_id: "r1".to_owned(),
        stage: ScreeningStage::TitleAbstract,
        state,
        reason: None,
        decided_at: at.to_owned(),
    }
}

#[test]
fn screening_decision_saved_to_list_file() {
    let d = decision(
        "d1",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00Z",
    );
    let text = record_decision(LIST, &d).unwrap();
    assert_eq!(list_decisions(&text).unwrap(), vec![d]);
    // The rest of the file is kept as it was.
    let file = read_list_file(&text).unwrap();
    assert_eq!(file.body, "What this list is for.\n");
    let keys: Vec<&str> = file.fields.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(keys, ["wf", "weaveforge-id", "title", "color"]);
    assert!(text.contains("title: \"Review: LLMs\""));
}

#[test]
fn same_paper_decided_twice() {
    let first = decision(
        "d1",
        "item-1",
        ScreeningState::Unsure,
        "2026-11-19T10:00:00Z",
    );
    let second = decision(
        "d2",
        "item-1",
        ScreeningState::Excluded,
        "2026-11-19T11:00:00Z",
    );
    // Written out of time order: the later `added` still wins.
    let text = record_decision(LIST, &second).unwrap();
    let text = record_decision(&text, &first).unwrap();
    let all = list_decisions(&text).unwrap();
    assert_eq!(all.len(), 2, "both entries stay");
    assert_eq!(effective_decisions(&all), vec![second]);
}

#[test]
fn recording_the_same_id_again_replaces_it() {
    let d = decision(
        "d1",
        "item-1",
        ScreeningState::Unsure,
        "2026-11-19T10:00:00Z",
    );
    let changed = decision(
        "d1",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:05:00Z",
    );
    let text = record_decision(&record_decision(LIST, &d).unwrap(), &changed).unwrap();
    assert_eq!(list_decisions(&text).unwrap(), vec![changed]);
}

#[test]
fn paper_removed_from_library() {
    let kept = decision(
        "d1",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00Z",
    );
    let gone = decision(
        "d2",
        "item-2",
        ScreeningState::Excluded,
        "2026-11-19T10:00:00Z",
    );
    let text = record_decision(&record_decision(LIST, &kept).unwrap(), &gone).unwrap();
    let text = mark_missing(&text, &["item-1".to_owned()]).unwrap();
    let file = read_list_file(&text).unwrap();
    assert_eq!(file.entries.len(), 2, "the entry is kept");
    assert!(!file.entries[0].missing);
    assert!(file.entries[1].missing, "and marked missing");
    // The paper comes back: the mark goes away.
    let text = mark_missing(&text, &["item-1".to_owned(), "item-2".to_owned()]).unwrap();
    assert!(
        read_list_file(&text)
            .unwrap()
            .entries
            .iter()
            .all(|e| !e.missing)
    );
}

#[test]
fn reason_with_newline_and_quote() {
    let mut d = decision(
        "d1",
        "item-1",
        ScreeningState::Excluded,
        "2026-11-19T10:00:00Z",
    );
    d.stage = ScreeningStage::FullText;
    d.reason = Some("wrong \"population\"\nsecond line\\ and \u{2028} sep".to_owned());
    let text = record_decision(LIST, &d).unwrap();
    assert_eq!(list_decisions(&text).unwrap(), vec![d]);
}

#[test]
fn empty_list() {
    let text = "---\nwf: 3\ntitle: Empty\n---\n";
    assert_eq!(list_decisions(text).unwrap(), vec![]);
    let d = decision(
        "d1",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00Z",
    );
    let text = remove_decision(&record_decision(text, &d).unwrap(), "d1").unwrap();
    assert_eq!(list_decisions(&text).unwrap(), vec![]);
    assert_eq!(text, "---\nwf: 3\ntitle: Empty\n---\n");
}

#[test]
fn file_without_version_gets_one() {
    let d = decision(
        "d1",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00Z",
    );
    let text = record_decision("---\ntitle: Old\n---\n", &d).unwrap();
    assert!(text.starts_with("---\nwf: 3\ntitle: Old\n"));
}

#[test]
fn newer_format_is_read_but_never_written() {
    let newer = "---\nwf: 4\ntitle: Future\n---\n";
    assert!(list_decisions(newer).is_ok());
    let d = decision(
        "d1",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00Z",
    );
    assert_eq!(
        record_decision(newer, &d),
        Err(ListFileError::NewerFormat(4))
    );
    assert_eq!(
        remove_decision(newer, "d1"),
        Err(ListFileError::NewerFormat(4))
    );
}

#[test]
fn damaged_entry_is_refused_not_dropped() {
    let damaged = "---\nwf: 3\nitems:\n  - {\"id\": \"d1\"\n---\n";
    assert!(matches!(
        list_decisions(damaged),
        Err(ListFileError::BadEntry(_))
    ));
    let d = decision(
        "d2",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00Z",
    );
    assert!(matches!(
        record_decision(damaged, &d),
        Err(ListFileError::BadEntry(_))
    ));
}

fn arb_text() -> impl Strategy<Value = String> {
    // Any Unicode, including quotes, backslashes, newlines and U+2028.
    proptest::collection::vec(any::<char>(), 0..24).prop_map(|cs| cs.into_iter().collect())
}

fn arb_decision() -> impl Strategy<Value = ScreeningDecision> {
    (
        "[a-z0-9]{1,6}",
        prop_oneof!["item-a", "item-b", "item-c"],
        prop_oneof!["r1", "r2"],
        prop_oneof![
            Just(ScreeningStage::TitleAbstract),
            Just(ScreeningStage::FullText)
        ],
        prop_oneof![
            Just(ScreeningState::Included),
            Just(ScreeningState::Excluded),
            Just(ScreeningState::Unsure)
        ],
        proptest::option::of(arb_text()),
        "2026-11-1[0-9]T1[0-9]:00:00Z",
    )
        .prop_map(
            |(id, item, reviewer, stage, state, reason, at)| ScreeningDecision {
                id,
                item_id: item,
                reviewer_id: reviewer,
                stage,
                state,
                reason,
                decided_at: at,
            },
        )
}

proptest! {
    /// Law 1: what is recorded reads back unchanged, whatever the text holds.
    #[test]
    fn law_record_reads_back(d in arb_decision()) {
        let text = record_decision(LIST, &d).unwrap();
        prop_assert_eq!(list_decisions(&text).unwrap(), vec![d]);
    }

    /// Law 2: recording never drops another entry; it adds one or replaces its own id.
    #[test]
    fn law_record_keeps_others(ds in proptest::collection::vec(arb_decision(), 0..12)) {
        let mut text = LIST.to_owned();
        let mut expected: Vec<ScreeningDecision> = Vec::new();
        for d in &ds {
            text = record_decision(&text, d).unwrap();
            match expected.iter_mut().find(|e| e.id == d.id) {
                Some(slot) => *slot = d.clone(),
                None => expected.push(d.clone()),
            }
        }
        prop_assert_eq!(list_decisions(&text).unwrap(), expected);
        // The list's own fields and body are never touched.
        let file = read_list_file(&text).unwrap();
        prop_assert_eq!(file.body, "What this list is for.\n");
        prop_assert_eq!(file.fields.len(), 4);
    }

    /// Law 3: the effective decision per item, reviewer and stage is the one with the
    /// latest `added`; a tie goes to the entry written later.
    #[test]
    fn law_latest_added_wins(ds in proptest::collection::vec(arb_decision(), 0..12)) {
        let effective = effective_decisions(&ds);
        for e in &effective {
            let same: Vec<&ScreeningDecision> = ds.iter().filter(|d| {
                d.item_id == e.item_id && d.reviewer_id == e.reviewer_id && d.stage == e.stage
            }).collect();
            let latest = same.iter().map(|d| d.decided_at.as_str()).max().unwrap();
            prop_assert_eq!(e.decided_at.as_str(), latest);
            let last_latest = same.iter().rev().find(|d| d.decided_at == latest).unwrap();
            prop_assert_eq!(e, *last_latest);
        }
        let keys: std::collections::HashSet<_> =
            ds.iter().map(|d| (&d.item_id, &d.reviewer_id, d.stage as u8)).collect();
        prop_assert_eq!(effective.len(), keys.len());
    }

    /// Law 4: marking missing never removes or changes a decision.
    #[test]
    fn law_mark_missing_keeps_decisions(
        ds in proptest::collection::vec(arb_decision(), 0..8),
        known in proptest::collection::vec(prop_oneof!["item-a", "item-b"], 0..3),
    ) {
        let mut text = LIST.to_owned();
        for d in &ds {
            text = record_decision(&text, d).unwrap();
        }
        let before = list_decisions(&text).unwrap();
        let known: Vec<String> = known.into_iter().collect();
        let marked = mark_missing(&text, &known).unwrap();
        prop_assert_eq!(list_decisions(&marked).unwrap(), before);
        for e in read_list_file(&marked).unwrap().entries {
            prop_assert_eq!(e.missing, !known.contains(&e.item));
        }
    }
}

/// Obsidian properties the app does not model: spaced keys, block scalars, comments,
/// nested lists and maps, and `items` sitting between them.
const OBSIDIAN: &str = "---\nwf: 3\nDue date: 2026-12-01\ndescription: |\n  line one\n  line two\n# kept comment\ncssclasses:\n  - wide\n  - dark\nitems:\n  - {\"id\":\"d0\",\"item\":\"item-0\",\"reviewer\":\"r1\",\"stage\":\"title_abstract\",\"decision\":\"unsure\",\"added\":\"2026-11-18T10:00:00Z\"}\nnested:\n  a: 1\n  b: \"two\"\ntags: [x, \"y z\"]\n---\nBody.\n";

/// The frontmatter lines outside the `items` block, as written.
#[cfg(test)]
fn other_head_lines(text: &str) -> Vec<String> {
    let text = text.replace("\r\n", "\n");
    let head = text
        .strip_prefix("---\n")
        .unwrap()
        .split("\n---\n")
        .next()
        .unwrap();
    let mut out = Vec::new();
    let mut in_items = false;
    for line in head.lines() {
        if line.starts_with("items:") {
            in_items = true;
            continue;
        }
        if in_items && (line.starts_with(' ') || line.starts_with('-')) {
            continue;
        }
        in_items = false;
        out.push(line.to_owned());
    }
    out
}

#[test]
fn obsidian_properties_survive_every_write() {
    let before = other_head_lines(OBSIDIAN);
    let d = decision(
        "d1",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00Z",
    );
    let recorded = record_decision(OBSIDIAN, &d).unwrap();
    assert_eq!(other_head_lines(&recorded), before, "record_decision");
    assert!(recorded.ends_with("---\nBody.\n"));
    assert_eq!(list_decisions(&recorded).unwrap().len(), 2);
    let removed = remove_decision(&recorded, "d0").unwrap();
    assert_eq!(other_head_lines(&removed), before, "remove_decision");
    let marked = mark_missing(&removed, &[]).unwrap();
    assert_eq!(other_head_lines(&marked), before, "mark_missing");
    assert!(
        read_list_file(&marked)
            .unwrap()
            .entries
            .iter()
            .all(|e| e.missing)
    );
    let emptied = remove_decision(&marked, "d1").unwrap();
    assert_eq!(other_head_lines(&emptied), before, "last entry removed");
    assert!(list_decisions(&emptied).unwrap().is_empty());
}

#[test]
fn removing_an_absent_entry_leaves_the_file_byte_identical() {
    assert_eq!(remove_decision(OBSIDIAN, "nope").unwrap(), OBSIDIAN);
}

#[test]
fn crlf_list_file_stays_crlf() {
    let crlf = OBSIDIAN.replace('\n', "\r\n");
    let d = decision(
        "d1",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00Z",
    );
    let text = record_decision(&crlf, &d).unwrap();
    assert!(
        !text.replace("\r\n", "").contains('\n'),
        "bare LF in {text:?}"
    );
    assert_eq!(other_head_lines(&text), other_head_lines(OBSIDIAN));
}

#[test]
fn later_instant_wins_across_precision_and_offsets() {
    let whole = decision(
        "a",
        "item-1",
        ScreeningState::Excluded,
        "2026-11-19T10:00:00Z",
    );
    let half = decision(
        "b",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:00:00.500Z",
    );
    for pair in [[whole.clone(), half.clone()], [half.clone(), whole.clone()]] {
        assert_eq!(effective_decisions(&pair)[0].id, "b");
    }
    // 10:30 at +01:00 is 09:30Z, earlier than 10:00Z, though it sorts later as text.
    let offset = decision(
        "c",
        "item-1",
        ScreeningState::Included,
        "2026-11-19T10:30:00+01:00",
    );
    for pair in [[whole.clone(), offset.clone()], [offset, whole]] {
        assert_eq!(effective_decisions(&pair)[0].id, "a");
    }
}

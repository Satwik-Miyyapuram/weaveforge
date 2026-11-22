//! Laws of `wf_core::entity_codecs` (0.9.7 L3): one codec per kind, shared by the
//! upgrade export and the File* repositories, so the two never drift.
#![allow(clippy::expect_used, clippy::panic, missing_docs)]

use serde_json::{Map, Value, json};
use wf_core::entity_codecs::{
    CodecError, EntityKind, entity_path, parse_entity_row, render_entity_row,
};

fn row(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => panic!("row must be an object"),
    }
}

fn round_trip(kind: EntityKind, value: Value) {
    let input = row(value);
    let text = render_entity_row(kind, None, &input).expect("renders");
    let back = parse_entity_row(kind, &text).expect("parses");
    assert_eq!(back, input, "{text}");
    // A second render of the read row writes the same bytes.
    assert_eq!(
        render_entity_row(kind, Some(&text), &back).expect("re-renders"),
        text
    );
}

#[test]
fn log_entry_round_trips_with_links_and_unicode() {
    round_trip(
        EntityKind::LogEntry,
        json!({
            "id": "log-1",
            "entryDate": "2026-11-21",
            "kind": "daily",
            "body": "Read Ölçü paper — “quotes”\nsecond line",
            "links": [{"type": "paper", "id": "p1"}],
            "createdAt": "2026-11-21T09:00:00Z"
        }),
    );
}

#[test]
fn experiment_round_trips_every_field() {
    round_trip(
        EntityKind::Experiment,
        json!({
            "id": "exp-1",
            "name": "Ablation: no dropout",
            "hypothesis": "Dropout hurts\non small data",
            "status": "running",
            "repoUrl": "https://github.com/a/b",
            "commitSha": "abc123",
            "branch": "main",
            "runCommand": "python train.py --lr 0.1",
            "config": {"lr": 0.1, "layers": [1, 2]},
            "metrics": {"acc": 0.9},
            "artifacts": ["out/model.pt"],
            "resultNote": "It helped.",
            "startedAt": "2026-11-01T00:00:00Z",
            "finishedAt": "2026-11-02T00:00:00Z",
            "relatedPaper": "p1",
            "createdAt": "2026-10-31T00:00:00Z"
        }),
    );
}

#[test]
fn report_section_and_reading_list_round_trip() {
    round_trip(
        EntityKind::ReportSection,
        json!({
            "id": "s1", "title": "Intro", "sectionNo": "1.2", "parentId": "s0",
            "status": "drafting", "wordCount": 120, "targetWords": 800,
            "deadline": "2026-12-01", "draftUrl": "https://x", "notes": "todo",
            "sortOrder": 2.5, "createdAt": "2026-11-01T00:00:00Z", "updatedAt": "2026-11-02T00:00:00Z"
        }),
    );
    round_trip(
        EntityKind::ReadingList,
        json!({
            "id": "l1", "name": "Core", "description": "Must read", "parentId": "l0",
            "sortOrder": 1, "color": "#ff0000", "createdAt": "2026-11-01T00:00:00Z",
            "members": ["[[Smith 2024.paper]]", "[[My note]]"],
            "memberNotes": {"[[Smith 2024.paper]]": "key paper"}
        }),
    );
}

#[test]
fn absent_optional_fields_stay_absent() {
    round_trip(
        EntityKind::Experiment,
        json!({"id": "e", "name": "x", "status": "planned", "config": {}, "metrics": {},
               "artifacts": [], "createdAt": "2026-01-01T00:00:00Z"}),
    );
}

#[test]
fn save_keeps_unknown_keys_raw_and_in_place() {
    // A list file that also holds screening entries (block list) and a user property.
    let text = "---\nweaveforge-id: \"l1\"\nweaveforge-type: \"reading_list\"\nitems:\n  - {\"id\":\"d1\",\"item\":\"[[A]]\"}\nmine: hello\ntitle: \"Old\"\n---\nDesc\n";
    let mut r = parse_entity_row(EntityKind::ReadingList, text).expect("parses");
    assert_eq!(r.get("name"), Some(&json!("Old")));
    let _ = r.insert("name".into(), json!("New"));
    let out = render_entity_row(EntityKind::ReadingList, Some(text), &r).expect("renders");
    assert!(
        out.contains(
            "items:\n  - {\"id\":\"d1\",\"item\":\"[[A]]\"}\nmine: hello\ntitle: \"New\"\n"
        ),
        "{out}"
    );
}

#[test]
fn a_cleared_field_is_removed() {
    let input = row(
        json!({"id": "s", "title": "T", "status": "done", "wordCount": 0, "sortOrder": 0,
                           "deadline": "2026-01-01", "createdAt": "c"}),
    );
    let text = render_entity_row(EntityKind::ReportSection, None, &input).expect("renders");
    let mut next = input.clone();
    let _ = next.remove("deadline");
    let out = render_entity_row(EntityKind::ReportSection, Some(&text), &next).expect("renders");
    assert!(!out.contains("deadline"), "{out}");
}

#[test]
fn reads_the_0_9_5_serializer_shapes() {
    // `serialize_workspace` wrote bare scalars and the experiment notes as body sections.
    let exp = "---\nweaveforge-id: e1\nweaveforge-type: experiment\ntitle: Run A\nstatus: done\nrepo-url: https://g/x\ncreated-at: 2026-01-01T00:00:00Z\naliases: [Run A]\n---\n## Hypothesis\n\nH text\n\n## Result\n\nR text\n";
    let r = parse_entity_row(EntityKind::Experiment, exp).expect("parses");
    assert_eq!(r.get("name"), Some(&json!("Run A")));
    assert_eq!(r.get("hypothesis"), Some(&json!("H text")));
    assert_eq!(r.get("resultNote"), Some(&json!("R text")));
    assert_eq!(r.get("repoUrl"), Some(&json!("https://g/x")));

    let sec = "---\nweaveforge-id: s1\nweaveforge-type: report_section\ntitle: Intro\ntarget-words: 500\ncreated-at: c\n---\nnotes\n";
    let r = parse_entity_row(EntityKind::ReportSection, sec).expect("parses");
    assert_eq!(r.get("targetWords"), Some(&json!(500)));
    assert_eq!(r.get("notes"), Some(&json!("notes")));
}

#[test]
fn crlf_and_empty_body_are_fine() {
    let text = "---\r\nweaveforge-id: \"x\"\r\nweaveforge-type: \"log_entry\"\r\nentry-date: \"2026-01-02\"\r\nkind: \"weekly\"\r\ncreated-at: \"c\"\r\n---\r\n";
    let r = parse_entity_row(EntityKind::LogEntry, text).expect("parses");
    assert_eq!(r.get("kind"), Some(&json!("weekly")));
    assert_eq!(r.get("body"), Some(&json!("")));
}

#[test]
fn refuses_other_kinds_newer_files_and_rows_without_id() {
    let exp = "---\nweaveforge-id: e1\nweaveforge-type: experiment\n---\n";
    assert!(matches!(
        parse_entity_row(EntityKind::LogEntry, exp),
        Err(CodecError::NotThisKind)
    ));
    assert!(matches!(
        parse_entity_row(EntityKind::LogEntry, ""),
        Err(CodecError::NotThisKind)
    ));
    let newer = "---\nweaveforge-id: e1\nweaveforge-type: experiment\nwf: 99\n---\n";
    assert!(matches!(
        parse_entity_row(EntityKind::Experiment, newer),
        Err(CodecError::NewerFormat(99))
    ));
    let r = row(json!({"id": "e1", "name": "n"}));
    assert!(matches!(
        render_entity_row(EntityKind::Experiment, Some(newer), &r),
        Err(CodecError::NewerFormat(99))
    ));
    assert!(matches!(
        render_entity_row(EntityKind::Experiment, None, &row(json!({"name": "n"}))),
        Err(CodecError::BadRow(_))
    ));
    // Saving over a file of another item is refused: ids never change under a save.
    assert!(matches!(
        render_entity_row(EntityKind::Experiment, Some(exp), &row(json!({"id": "e2"}))),
        Err(CodecError::BadRow(_))
    ));
}

#[test]
fn paths_follow_the_folder_layout() {
    let log = row(json!({"id": "0123456789abcdef", "entryDate": "2026-11-21"}));
    assert_eq!(
        entity_path(EntityKind::LogEntry, &log, "proj").expect("path"),
        wf_core::sync::folder_layout::log_path("0123456789abcdef", "2026-11-21", "proj")
    );
    let exp = row(json!({"id": "0123456789abcdef", "name": "Ünïcode run"}));
    assert_eq!(
        entity_path(EntityKind::Experiment, &exp, "").expect("path"),
        wf_core::sync::folder_layout::flat_path(
            wf_core::sync::folder_layout::WorkspaceEntityType::Experiment,
            "0123456789abcdef",
            "Ünïcode run",
            ""
        )
    );
    // Duplicate titles still get distinct paths (the id suffix differs).
    let a = row(json!({"id": "aaaaaaaa1", "title": "Same"}));
    let b = row(json!({"id": "bbbbbbbb2", "title": "Same"}));
    assert_ne!(
        entity_path(EntityKind::ReportSection, &a, "").expect("path"),
        entity_path(EntityKind::ReportSection, &b, "").expect("path")
    );
}

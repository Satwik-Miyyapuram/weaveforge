//! Ports of `packages/core/test/workspace/json-entities.test.ts`, one `#[test]`
//! per TS case. A stored key holding `undefined` in TS is an absent key here,
//! because JSON cannot spell `undefined` and `serde_json::Map` has no such value.

// Golden-reading helpers sit outside `#[test]`, where clippy.toml's test allowance stops.
#![allow(clippy::expect_used, clippy::panic)]

use serde_json::{Map, Value, json};
use wf_core::sync::change_origin::ChangeSide;
use wf_core::sync::folder_layout::{WorkspaceProject, project_dir};
use wf_core::sync::import_action::{ActionCounts, ConflictKind, ImportAction};
use wf_core::sync::json_entities::{
    ParsedJsonData, WorkspaceJsonKind, add_counts, diff_json_data, is_app_owned_path,
    json_data_path, json_kind_of_path, parse_json_data,
};

type Row = Map<String, Value>;

fn root() -> String {
    project_dir(&WorkspaceProject {
        id: "8d731734-bdcd-4f08-b648-efd15fdf75da".to_owned(),
        name: "MSc Thesis".to_owned(),
    })
}

fn row(value: Value) -> Row {
    match value {
        Value::Object(map) => map,
        other => panic!("not an object: {other}"),
    }
}

fn parse(content: &str, kind: WorkspaceJsonKind) -> ParsedJsonData {
    parse_json_data("p", content, kind).expect("parses")
}

fn ids(parsed: &ParsedJsonData) -> Vec<&str> {
    parsed
        .rows
        .iter()
        .filter_map(|r| r.get("id").and_then(Value::as_str))
        .collect()
}

fn with_origin(side: ChangeSide) -> impl Fn(&str) -> ChangeSide {
    move |_| side
}

#[test]
fn the_three_data_files_are_the_readers_the_machinery_is_not() {
    let root = root();
    let data = [
        format!("{root}/.weaveforge/relations.json"),
        format!("{root}/.weaveforge/tags.json"),
        format!("{root}/.weaveforge/reading-list-items.json"),
        format!("{root}/notes/README.md"),
    ];
    for path in &data {
        assert!(!is_app_owned_path(path), "{path}");
    }

    let machinery = [
        format!("{root}/.weaveforge/db/PG_VERSION"),
        ".weaveforge/db/postgresql.conf".to_owned(),
        format!("{root}/.weaveforge/db-backups/local-db-2026-09-29.tar.gz"),
        format!("{root}/.weaveforge/cache/pdf-text/x.json"),
        ".weaveforge/cache/pdf-text/x.json".to_owned(),
        format!("{root}/.weaveforge/mirror.json"),
        ".weaveforge/mirror.json".to_owned(),
        format!("{root}/.weaveforge/manifest.json"),
        format!("{root}/.weaveforge/db-relocated"),
        ".git/index".to_owned(),
        ".git/objects/28/db3fc3006ab17501aafae99b609a4f777235c2".to_owned(),
        "README.md".to_owned(),
        format!("{root}/papers/pdf/5f1c2e9a.pdf"),
        "papers/html/p1.html".to_owned(),
    ];
    for path in &machinery {
        assert!(is_app_owned_path(path), "{path}");
    }
}

#[test]
fn a_path_names_one_of_the_three_kinds_or_none() {
    let root = root();
    assert_eq!(
        json_kind_of_path(&format!("{root}/.weaveforge/relations.json")),
        Some(WorkspaceJsonKind::Relations)
    );
    assert_eq!(
        json_kind_of_path(&format!("{root}/.weaveforge/tags.json")),
        Some(WorkspaceJsonKind::Tags)
    );
    assert_eq!(
        json_kind_of_path(&format!("{root}/.weaveforge/reading-list-items.json")),
        Some(WorkspaceJsonKind::ReadingListItems)
    );
    // The manifest is data about the mirror, not data to import.
    assert_eq!(
        json_kind_of_path(&format!("{root}/.weaveforge/mirror.json")),
        None
    );
    assert_eq!(json_kind_of_path(&format!("{root}/notes/a.note.md")), None);
    assert_eq!(
        json_data_path(&root, WorkspaceJsonKind::Relations),
        format!("{root}/.weaveforge/relations.json")
    );
}

#[test]
fn an_unreadable_file_says_nothing_rather_than_nothing_is_left() {
    // A truncated write, a file of another shape, a `.json` from somewhere else:
    // reading any of them as "no rows" would turn a syntax error into a deletion.
    assert!(parse_json_data("p", r#"{"not":"an array"}"#, WorkspaceJsonKind::Relations).is_none());
    assert!(parse_json_data("p", r#"[{"id": "#, WorkspaceJsonKind::Relations).is_none());
    assert!(parse_json_data("p", "not json at all", WorkspaceJsonKind::Relations).is_none());

    let parsed = parse(
        r#"[{"id":"r1"},{"noId":true},{"id":""},{"id":"r2"}]"#,
        WorkspaceJsonKind::Relations,
    );
    assert_eq!(ids(&parsed), ["r1", "r2"]);
}

#[test]
fn an_id_nothing_has_is_a_creation_and_a_matching_row_is_unchanged() {
    let parsed = parse(
        r#"[{"id":"r1","fromPaper":"a","toPaper":"b"}]"#,
        WorkspaceJsonKind::Relations,
    );

    let created = diff_json_data(&parsed, &[], None);
    assert_eq!(created.counts.created, 1);
    assert_eq!(created.entries[0].action, ImportAction::Created);

    let stored = [row(json!({"id": "r1", "fromPaper": "a", "toPaper": "b"}))];
    let unchanged = diff_json_data(&parsed, &stored, None);
    assert_eq!(unchanged.counts.unchanged, 1);
}

#[test]
fn a_stored_field_holding_undefined_matches_a_file_that_leaves_it_out() {
    let relations = parse(
        r#"[{"id":"r1","fromPaper":"a","toPaper":"b"}]"#,
        WorkspaceJsonKind::Relations,
    );
    let tags = parse(r#"[{"id":"t1","name":"ml"}]"#, WorkspaceJsonKind::Tags);

    // The stored rows have no `note` / `color` key: the Rust form of `undefined`.
    let r = diff_json_data(
        &relations,
        &[row(json!({"id": "r1", "fromPaper": "a", "toPaper": "b"}))],
        None,
    );
    assert_eq!(r.counts.unchanged, 1);
    let t = diff_json_data(&tags, &[row(json!({"id": "t1", "name": "ml"}))], None);
    assert_eq!(t.counts.unchanged, 1);
}

#[test]
fn numbers_compare_as_json_stringify_prints_them() {
    // JSON.stringify gives "0" for -0 and "1" for 1.0, so these rows match in TS.
    let parsed = parse(
        r#"[{"id":"r1","w":-0,"n":1.0,"x":[0.5]}]"#,
        WorkspaceJsonKind::Relations,
    );
    let same = [row(json!({"id": "r1", "w": 0, "n": 1, "x": [0.5]}))];
    let other = [row(json!({"id": "r1", "w": 0, "n": 2, "x": [0.5]}))];

    assert_eq!(diff_json_data(&parsed, &same, None).counts.unchanged, 1);
    assert_eq!(diff_json_data(&parsed, &other, None).counts.updated, 1);
}

#[test]
fn a_file_neither_side_moved_since_the_last_sync_is_not_an_update() {
    let parsed = parse(
        r#"[{"id":"r1","note":"same"}]"#,
        WorkspaceJsonKind::Relations,
    );
    let stored = [row(json!({"id": "r1", "note": "differs"}))];
    let f = with_origin(ChangeSide::Neither);
    let diff = diff_json_data(&parsed, &stored, Some(&f));
    assert_eq!(diff.counts.updated, 0);
}

#[test]
fn which_side_moved_decides_between_an_update_silence_and_a_conflict() {
    let parsed = parse(
        r#"[{"id":"r1","note":"the folder version"}]"#,
        WorkspaceJsonKind::Relations,
    );
    let stored = [row(json!({"id": "r1", "note": "the workspace version"}))];

    // The folder moved it: apply it.
    let folder = with_origin(ChangeSide::Folder);
    let from_folder = diff_json_data(&parsed, &stored, Some(&folder));
    assert_eq!(from_folder.counts.updated, 1);

    // The workspace moved it: the folder's copy is the stale one.
    let workspace = with_origin(ChangeSide::Workspace);
    let from_workspace = diff_json_data(&parsed, &stored, Some(&workspace));
    assert_eq!(from_workspace.counts.unchanged, 1);
    assert_eq!(from_workspace.counts.updated, 0);

    // Both moved it: ask, never guess.
    let both = with_origin(ChangeSide::Both);
    let both_diff = diff_json_data(&parsed, &stored, Some(&both));
    assert_eq!(both_diff.counts.conflict, 1);
    assert_eq!(
        both_diff.entries[0].conflict_kind,
        Some(ConflictKind::BothChanged)
    );

    // No manifest to consult — an older folder, another machine: the reader judges.
    assert_eq!(diff_json_data(&parsed, &stored, None).counts.updated, 1);
}

#[test]
fn a_row_the_file_stopped_listing_is_a_removal_reported_and_not_applied() {
    let parsed = parse(r#"[{"id":"r1"}]"#, WorkspaceJsonKind::Relations);
    let stored = [row(json!({"id": "r1"})), row(json!({"id": "gone"}))];

    let diff = diff_json_data(&parsed, &stored, None);
    assert_eq!(diff.counts.removed, 1);
    let removed = diff
        .entries
        .iter()
        .find(|entry| entry.action == ImportAction::Removed)
        .expect("a removal entry");
    assert_eq!(removed.existing.get("id"), Some(&json!("gone")));
}

#[test]
fn counts_add_up_across_the_two_halves_of_one_preview() {
    let a = ActionCounts {
        created: 1,
        updated: 0,
        unchanged: 2,
        conflict: 0,
        removed: 0,
    };
    let b = ActionCounts {
        created: 0,
        updated: 1,
        unchanged: 0,
        conflict: 1,
        removed: 3,
    };
    assert_eq!(
        add_counts(a, b),
        ActionCounts {
            created: 1,
            updated: 1,
            unchanged: 2,
            conflict: 1,
            removed: 3,
        }
    );
}

#[test]
fn rows_only_the_workspace_added_or_dropped_since_the_mirror_are_not_removals_or_creations() {
    // Sync pulled a new tag and deleted another before the mirror caught up.
    let parsed = parse(
        r#"[{"id":"t1","name":"ml"},{"id":"gone","name":"old"}]"#,
        WorkspaceJsonKind::Tags,
    );
    let stored = [
        row(json!({"id": "t1", "name": "ml"})),
        row(json!({"id": "fresh", "name": "new"})),
    ];
    for side in [ChangeSide::Workspace, ChangeSide::Neither] {
        let origin = with_origin(side);
        let diff = diff_json_data(&parsed, &stored, Some(&origin));
        assert_eq!(diff.counts.removed, 0, "{side:?}");
        assert_eq!(diff.counts.created, 0, "{side:?}");
        assert_eq!(diff.counts.unchanged, 3, "{side:?}");
    }

    // Edited out there: the reader's adds and drops are real.
    let folder = with_origin(ChangeSide::Folder);
    let diff = diff_json_data(&parsed, &stored, Some(&folder));
    assert_eq!(diff.counts.removed, 1);
    assert_eq!(diff.counts.created, 1);
}

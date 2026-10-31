//! Ports of the `parseWorkspaceFile`, `parseWorkspaceFolder` and `diffWorkspace`
//! cases in `packages/core/test/workspace/` and `packages/core/test/ink/` that do
//! not need `serializeWorkspace`, plus Rust cases for the import rules. Cases that
//! serialize first are ported with the serializer's tests.

use serde_json::Map;
use wf_core::sync::change_origin::ChangeSide;
use wf_core::sync::deserialize::{
    ExistingEntity, ImportDiff, ParsedEntity, diff_workspace, parse_workspace_file,
    parse_workspace_folder,
};
use wf_core::sync::folder_layout::{ENTITY_DIRS, WorkspaceEntityType};
use wf_core::sync::import_action::{ConflictKind, ImportAction};
use wf_core::sync::ink_note::{INK_BODY_HEADER, default_ink_note_meta, write_ink_note_body};
use wf_core::sync::text_diff::write_conflict_markers;

const OURS: &str = "# Method\n\nWe ran three seeds.\nThe effect held.\n";
const THEIRS: &str = "# Method\n\nWe ran five seeds.\nThe effect held.\nIt was smaller.\n";

fn folder(files: &[(&str, &str)]) -> Vec<(String, String)> {
    files
        .iter()
        .map(|(path, content)| ((*path).to_owned(), (*content).to_owned()))
        .collect()
}

fn existing(id: &str, entity_type: WorkspaceEntityType, title: &str, body: &str) -> ExistingEntity {
    ExistingEntity {
        id: id.to_owned(),
        entity_type,
        title: title.to_owned(),
        body: body.to_owned(),
    }
}

fn note_entity(id: Option<&str>, title: &str, body: &str, path: &str) -> ParsedEntity {
    ParsedEntity {
        id: id.map(str::to_owned),
        entity_type: WorkspaceEntityType::VaultPage,
        title: title.to_owned(),
        body: body.to_owned(),
        path: path.to_owned(),
        fields: Map::new(),
    }
}

/// The note the change-origin tests compare against `stored()`.
fn folder_note() -> ParsedEntity {
    note_entity(
        Some("n1"),
        "Edited outside",
        "from the folder",
        "notes/n1.note.md",
    )
}

fn stored() -> Vec<ExistingEntity> {
    vec![existing(
        "n1",
        WorkspaceEntityType::VaultPage,
        "Original",
        "in the workspace",
    )]
}

/// A diff whose origin answers `side` for every path.
fn diff_with_side(
    parsed: &[ParsedEntity],
    stored: &[ExistingEntity],
    side: ChangeSide,
) -> ImportDiff {
    let fixed = move |_: &str| side;
    let origin: &dyn Fn(&str) -> ChangeSide = &fixed;
    diff_workspace(parsed, stored, Some(origin))
}

// ------------------------------------------------------- entity types and paths

#[test]
fn declared_type_is_read_back_for_every_type() {
    for (entity_type, _) in ENTITY_DIRS {
        let content = format!("---\nweaveforge-type: {}\n---\nbody", entity_type.as_str());
        // An ink note is folded into the note it is stored as.
        let expected = if *entity_type == WorkspaceEntityType::InkPage {
            WorkspaceEntityType::VaultPage
        } else {
            *entity_type
        };
        let parsed = parse_workspace_file("loose/x.md", &content);
        assert_eq!(
            parsed.map(|e| e.entity_type),
            Some(expected),
            "{}",
            entity_type.as_str()
        );
    }
    // An unknown declaration falls back to the directory.
    let widget = "---\nweaveforge-type: widget\n---\nb";
    assert_eq!(
        parse_workspace_file("papers/x.md", widget).map(|e| e.entity_type),
        Some(WorkspaceEntityType::Paper)
    );
    assert_eq!(parse_workspace_file("loose/x.md", widget), None);
}

#[test]
fn every_entity_directory_names_its_type() {
    for (entity_type, dir) in ENTITY_DIRS {
        // `notes` holds ink notes too, but a plain file there is a note.
        let expected = if *dir == "notes" {
            WorkspaceEntityType::VaultPage
        } else {
            *entity_type
        };
        let root = format!("{dir}/x.md");
        let nested = format!("thesis--8d7317/{dir}/x.md");
        assert_eq!(
            parse_workspace_file(&root, "body").map(|e| e.entity_type),
            Some(expected),
            "{dir}"
        );
        assert_eq!(
            parse_workspace_file(&nested, "body").map(|e| e.entity_type),
            Some(expected),
            "{dir}"
        );
    }
}

#[test]
fn folder_written_before_suffixes_existed_still_imports() {
    let parsed = parse_workspace_folder(&folder(&[(
        "notes/hand-written.md",
        "Typed into the folder.",
    )]));

    assert_eq!(parsed[0].entity_type, WorkspaceEntityType::VaultPage);
    assert_eq!(parsed[0].title, "hand-written");
}

#[test]
fn directory_outranks_suffix() {
    let parsed = parse_workspace_folder(&folder(&[("notes/misfiled.paper.md", "Body.")]));

    assert_eq!(parsed[0].entity_type, WorkspaceEntityType::VaultPage);
    assert_eq!(parsed[0].title, "misfiled");
}

#[test]
fn suffix_rescues_file_no_directory_speaks_for() {
    let parsed = parse_workspace_folder(&folder(&[("inbox/idea.note.md", "Body.")]));

    assert_eq!(parsed[0].entity_type, WorkspaceEntityType::VaultPage);
    assert_eq!(parsed[0].title, "idea");
}

#[test]
fn hand_written_file_inside_project_folder_still_imports() {
    let parsed = parse_workspace_folder(&folder(&[(
        "msc-thesis--8d7317/notes/hand-written.md",
        "Typed into the folder.",
    )]));

    assert_eq!(parsed[0].entity_type, WorkspaceEntityType::VaultPage);
    assert_eq!(parsed[0].title, "hand-written");
}

#[test]
fn bookkeeping_beside_project_files_is_never_an_entity() {
    let parsed = parse_workspace_folder(&folder(&[
        ("msc-thesis--8d7317/.weaveforge/notes.md", "See the notes."),
        (".weaveforge/notes.md", "And the root copy."),
        ("msc-thesis--8d7317/README.md", "About this project."),
    ]));

    assert!(parsed.is_empty());
}

// ------------------------------------------------------------------ hard rules

#[test]
fn meta_dir_segment_is_never_an_entity() {
    let content = "---\nweaveforge-type: vault_page\n---\nb";
    assert_eq!(parse_workspace_file(".weaveforge/notes.md", content), None);
    assert_eq!(
        parse_workspace_file("notes/.weaveforge/x.md", content),
        None
    );
}

#[test]
fn non_markdown_file_is_never_an_entity() {
    let content = "---\nweaveforge-type: vault_page\n---\nb";
    assert_eq!(parse_workspace_file("notes/x.txt", content), None);
    assert_eq!(parse_workspace_file("notes/x.markdown", content), None);
}

#[test]
fn readme_is_never_an_entity_at_any_depth() {
    let content = "---\nweaveforge-type: vault_page\n---\nb";
    assert_eq!(parse_workspace_file("README.md", content), None);
    assert_eq!(parse_workspace_file("notes/README.md", content), None);
    assert_eq!(parse_workspace_file("a/b/README.md", content), None);
    // Only the exact name is the README.
    assert!(parse_workspace_file("notes/readme.md", content).is_some());
}

#[test]
fn declared_unknown_type_falls_back_to_directory_then_suffix() {
    let widget = "---\nweaveforge-type: widget\n---\nb";
    assert_eq!(
        parse_workspace_file("papers/x.md", widget).map(|e| e.entity_type),
        Some(WorkspaceEntityType::Paper)
    );
    assert_eq!(
        parse_workspace_file("loose/x.report.md", widget).map(|e| e.entity_type),
        Some(WorkspaceEntityType::ReportSection)
    );
    assert_eq!(parse_workspace_file("loose/x.md", widget), None);
}

#[test]
fn ink_page_file_is_vault_page_with_body_rebuilt_from_its_header() {
    let content = "---\nweaveforge-id: n1\nweaveforge-type: ink_page\n---\n\nhello\n";
    let parsed = parse_workspace_file("notes/ink.ink.md", content).expect("an entity");

    assert_eq!(parsed.entity_type, WorkspaceEntityType::VaultPage);
    assert_eq!(parsed.id.as_deref(), Some("n1"));
    assert!(parsed.body.starts_with(INK_BODY_HEADER));
    assert_eq!(
        parsed.body,
        write_ink_note_body(&default_ink_note_meta(), "hello\n")
    );
}

#[test]
fn blank_title_falls_back_to_untitled() {
    let whitespace = parse_workspace_file("notes/ .md", "body").expect("an entity");
    assert_eq!(whitespace.title, "Untitled");

    // The id tail is all that is left of the name.
    let id_only = parse_workspace_file("notes/--abc.md", "body").expect("an entity");
    assert_eq!(id_only.title, "Untitled");
}

#[test]
fn filename_id_suffix_is_dropped_from_the_title_when_short_enough() {
    let short = parse_workspace_file("notes/My idea--a1b2c3.md", "body").expect("an entity");
    assert_eq!(short.title, "My idea");

    // Nine alphanumerics is over the eight the suffix may hold, so it stays.
    let long = parse_workspace_file("notes/Method--a1b2c3456.md", "body").expect("an entity");
    assert_eq!(long.title, "Method--a1b2c3456");
}

// ------------------------------------------------------------------- the diff

#[test]
fn file_with_no_id_imports_as_new_rather_than_being_rejected() {
    let parsed = parse_workspace_folder(&folder(&[(
        "notes/hand-written.md",
        "Typed straight into the folder.",
    )]));

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].id, None);
    assert_eq!(diff_workspace(&parsed, &[], None).counts.created, 1);
}

#[test]
fn empty_id_is_a_creation_even_when_an_entity_has_that_id() {
    let parsed = vec![note_entity(Some(""), "Method", "Body text.", "notes/x.md")];
    let stored = vec![existing(
        "",
        WorkspaceEntityType::Paper,
        "Method",
        "Body text.",
    )];
    let diff = diff_workspace(&parsed, &stored, None);

    assert_eq!(diff.entries[0].action, ImportAction::Created);
    assert_eq!(diff.entries[0].conflict_fields, None);
    assert_eq!(diff.entries[0].merge, None);
}

#[test]
fn file_neither_side_touched_is_unchanged_even_when_its_parse_is_lossy() {
    // A zero-width space is not JS whitespace, so the bodies differ after trim.
    let parsed = vec![note_entity(
        Some("n1"),
        "Method",
        "Body text.\u{200b}",
        "p.md",
    )];
    let stored = vec![existing(
        "n1",
        WorkspaceEntityType::VaultPage,
        "Method",
        "Body text.",
    )];
    let diff = diff_with_side(&parsed, &stored, ChangeSide::Neither);

    assert_eq!(diff.counts.updated, 0);
    assert_eq!(diff.counts.unchanged, 1);
}

#[test]
fn file_holding_markers_is_a_conflict_however_its_id_reads() {
    let id = "11111111-1111-4111-8111-111111111111";
    let marked = write_conflict_markers(OURS, THEIRS);
    let content = format!(
        "---\nweaveforge-id: {id}\nweaveforge-type: vault_page\ntitle: Method\n---\n{marked}"
    );
    let parsed = parse_workspace_folder(&folder(&[(
        "notes/method--a1b2c3.note.md",
        content.as_str(),
    )]));
    let stored = vec![existing(id, WorkspaceEntityType::VaultPage, "Method", OURS)];
    let diff = diff_with_side(&parsed, &stored, ChangeSide::Folder);

    assert_eq!(diff.entries[0].action, ImportAction::Conflict);
    assert_eq!(diff.entries[0].kind, Some(ConflictKind::Markers));
    assert!(
        diff.entries[0]
            .reason
            .as_deref()
            .unwrap_or("")
            .contains("conflict markers")
    );
}

#[test]
fn stamped_file_parses_back_as_that_entity() {
    // What a stamped hand-written file reads as: the id is added, the rest kept.
    let stamped = "---\nweaveforge-id: n1\ntitle: My idea\n---\n\nthe body\n";
    let parsed = parse_workspace_file("notes/My idea.md", stamped).expect("an entity");

    assert_eq!(parsed.id.as_deref(), Some("n1"));
    assert_eq!(parsed.title, "My idea");
    assert_eq!(parsed.body.trim(), "the body");
}

#[test]
fn a_folder_edit_is_an_update() {
    let diff = diff_with_side(&[folder_note()], &stored(), ChangeSide::Folder);

    assert_eq!(diff.entries[0].action, ImportAction::Updated);
}

#[test]
fn a_workspace_edit_is_not_something_to_import_back() {
    // The folder's copy is simply the older one; carrying it over would undo the
    // edit that has not been mirrored yet.
    let diff = diff_with_side(&[folder_note()], &stored(), ChangeSide::Workspace);

    assert_eq!(diff.entries[0].action, ImportAction::Unchanged);
}

#[test]
fn both_sides_moving_is_a_conflict_with_a_reason_naming_the_file() {
    let diff = diff_with_side(&[folder_note()], &stored(), ChangeSide::Both);

    assert_eq!(diff.entries[0].action, ImportAction::Conflict);
    assert_eq!(diff.entries[0].kind, Some(ConflictKind::BothChanged));
    assert!(
        diff.entries[0]
            .reason
            .as_deref()
            .unwrap_or("")
            .contains("notes/n1.note.md")
    );
}

#[test]
fn without_an_origin_the_diff_behaves_as_it_always_did() {
    let parsed = [folder_note()];
    let stored = stored();

    assert_eq!(
        diff_workspace(&parsed, &stored, None).entries[0].action,
        ImportAction::Updated
    );
    assert_eq!(
        diff_with_side(&parsed, &stored, ChangeSide::Unknown).entries[0].action,
        ImportAction::Updated
    );
}

#[test]
fn identical_copies_are_unchanged_whatever_the_origin_says() {
    let same = note_entity(
        Some("n1"),
        "Original",
        "in the workspace",
        "notes/n1.note.md",
    );
    let diff = diff_with_side(&[same], &stored(), ChangeSide::Both);

    assert_eq!(diff.entries[0].action, ImportAction::Unchanged);
}

#[test]
fn origin_sides_decide_between_unchanged_updated_and_conflict() {
    let parsed = [folder_note()];
    let stored = stored();
    let cases = [
        (ChangeSide::Neither, ImportAction::Unchanged),
        (ChangeSide::Workspace, ImportAction::Unchanged),
        (ChangeSide::Folder, ImportAction::Updated),
        (ChangeSide::Unknown, ImportAction::Updated),
        (ChangeSide::Both, ImportAction::Conflict),
    ];
    for (side, expected) in cases {
        let diff = diff_with_side(&parsed, &stored, side);
        assert_eq!(diff.entries[0].action, expected, "{side:?}");
    }
}

#[test]
fn id_claiming_another_type_is_a_type_mismatch_naming_both_types() {
    let parsed = parse_workspace_folder(&folder(&[(
        "papers/x.md",
        "---\nweaveforge-id: n1\nweaveforge-type: paper\n---\nbody",
    )]));
    let diff = diff_workspace(&parsed, &stored(), None);

    assert_eq!(diff.entries[0].action, ImportAction::Conflict);
    assert_eq!(diff.entries[0].kind, Some(ConflictKind::TypeMismatch));
    assert_eq!(
        diff.entries[0].reason.as_deref(),
        Some("The id in papers/x.md belongs to a vault_page, not a paper.")
    );
}

#[test]
fn counts_sum_to_the_number_of_entries() {
    let parsed = vec![
        note_entity(None, "New", "b", "notes/new.md"),
        note_entity(
            Some("n1"),
            "Original",
            "in the workspace",
            "notes/n1.note.md",
        ),
        folder_note(),
        note_entity(Some("zz"), "Other", "b", "notes/zz.md"),
    ];
    let stored = vec![
        existing(
            "n1",
            WorkspaceEntityType::VaultPage,
            "Original",
            "in the workspace",
        ),
        existing("zz", WorkspaceEntityType::Paper, "Other", "b"),
    ];
    let diff = diff_workspace(&parsed, &stored, None);

    let total = ImportAction::ALL
        .iter()
        .map(|a| diff.counts.get(*a))
        .sum::<usize>();
    assert_eq!(total, diff.entries.len());
    assert_eq!(diff.counts.created, 1);
    assert_eq!(diff.counts.unchanged, 1);
    assert_eq!(diff.counts.updated, 1);
    assert_eq!(diff.counts.conflict, 1);
    assert_eq!(diff.counts.removed, 0);
}

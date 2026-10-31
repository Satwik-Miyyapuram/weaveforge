//! Ports the round-trip and diff cases of
//! `packages/core/test/workspace/workspace-roundtrip.test.ts` (L165-L291) and the
//! parse half of the ink-note mirror case in `packages/core/test/ink/ink-note.test.ts`
//! (L305-L330): serialize a snapshot, parse the files back, diff them.

use std::collections::HashMap;

use wf_core::sync::deserialize::{
    ExistingEntity, ParsedEntity, diff_workspace, parse_workspace_file, parse_workspace_folder,
};
use wf_core::sync::folder_layout::{
    WORKSPACE_META_DIR, WorkspaceEntityType, WorkspaceProject, project_dir,
};
use wf_core::sync::ink_note::{default_ink_note_meta, read_ink_note_body, write_ink_note_body};
use wf_core::sync::serialize::serialize_workspace;
use wf_core::sync::workspace_snapshot::{
    SnapshotLogEntry, SnapshotPaper, SnapshotVaultPage, WorkspaceSnapshot,
};

fn project() -> WorkspaceProject {
    WorkspaceProject {
        id: "8d731734-bdcd-4f08-b648-efd15fdf75da".to_owned(),
        name: "MSc Thesis".to_owned(),
    }
}

fn at(path: &str) -> String {
    format!("{}/{path}", project_dir(&project()))
}

fn snapshot() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        collected_at: "2026-08-05T00:00:00.000Z".to_owned(),
        ..WorkspaceSnapshot::default()
    }
}

fn note() -> SnapshotVaultPage {
    SnapshotVaultPage {
        id: "n1".to_owned(),
        title: "Method".to_owned(),
        body: "Body text.".to_owned(),
        created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-02-01T00:00:00.000Z".to_owned(),
        ..SnapshotVaultPage::default()
    }
}

fn existing() -> ExistingEntity {
    ExistingEntity {
        id: "n1".to_owned(),
        entity_type: WorkspaceEntityType::VaultPage,
        title: "Method".to_owned(),
        body: "Body text.".to_owned(),
    }
}

fn notes_snapshot(pages: Vec<SnapshotVaultPage>) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        vault_pages: pages,
        ..snapshot()
    }
}

fn parsed_from(snap: &WorkspaceSnapshot) -> Vec<ParsedEntity> {
    parse_workspace_folder(&serialize_workspace(snap, &project()).files)
}

fn has_file(files: &[(String, String)], path: &str) -> bool {
    files.iter().any(|(p, _)| p == path)
}

// ------------------------------------------------------------------ round trip

#[test]
fn serialize_then_parse_preserves_id_type_title_and_body() {
    let snap = WorkspaceSnapshot {
        vault_pages: vec![
            note(),
            SnapshotVaultPage {
                id: "n2".to_owned(),
                title: "Baselines".to_owned(),
                parent_id: Some("n1".to_owned()),
                body: "Second.".to_owned(),
                ..note()
            },
        ],
        papers: vec![SnapshotPaper {
            id: "p1".to_owned(),
            title: "Attention".to_owned(),
            authors: vec!["Vaswani".to_owned()],
            year: Some(2017.0),
            tags: vec!["nlp".to_owned()],
            abstract_text: Some("Abstract text.".to_owned()),
            summary: Some("My notes.".to_owned()),
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            updated_at: "2026-01-02T00:00:00.000Z".to_owned(),
            ..SnapshotPaper::default()
        }],
        log_entries: vec![SnapshotLogEntry {
            id: "l1".to_owned(),
            entry_date: "2026-03-14".to_owned(),
            kind: "daily".to_owned(),
            body: "Ran it.".to_owned(),
            created_at: "2026-03-14T00:00:00.000Z".to_owned(),
        }],
        ..snapshot()
    };

    let parsed = parsed_from(&snap);
    let by_id: HashMap<&str, &ParsedEntity> = parsed
        .iter()
        .filter_map(|e| e.id.as_deref().map(|id| (id, e)))
        .collect();

    assert_eq!(parsed.len(), 4);
    assert_eq!(by_id["n1"].entity_type, WorkspaceEntityType::VaultPage);
    assert_eq!(by_id["n1"].title, "Method");
    assert!(by_id["n1"].body.contains("Body text"));
    assert_eq!(by_id["n2"].entity_type, WorkspaceEntityType::VaultPage);
    assert_eq!(by_id["n2"].title, "Baselines");
    assert!(by_id["n2"].body.contains("Second."));
    assert_eq!(by_id["p1"].entity_type, WorkspaceEntityType::Paper);
    assert_eq!(by_id["p1"].title, "Attention");
    assert!(by_id["p1"].body.contains("Abstract text"));
    assert_eq!(by_id["l1"].entity_type, WorkspaceEntityType::LogEntry);
    assert!(by_id["l1"].body.contains("Ran it."));
}

#[test]
fn serializing_twice_is_byte_identical() {
    let input = notes_snapshot(vec![
        note(),
        SnapshotVaultPage {
            id: "n2".to_owned(),
            title: "Other".to_owned(),
            ..note()
        },
    ]);

    let first = serialize_workspace(&input, &project());
    let second = serialize_workspace(&input, &project());
    assert!(!first.files.is_empty());
    assert_eq!(first, second);
}

#[test]
fn metadata_and_readme_are_written_but_are_not_entities() {
    let files = serialize_workspace(&notes_snapshot(vec![note()]), &project()).files;

    assert!(has_file(
        &files,
        &at(&format!("{WORKSPACE_META_DIR}/manifest.json"))
    ));
    assert!(has_file(&files, "README.md"));
    let parsed = parse_workspace_folder(&files);
    assert_eq!(parsed.len(), 1, "only the note is an entity");
    assert_eq!(parsed[0].id.as_deref(), Some("n1"));
}

#[test]
fn the_note_lands_alone_under_notes_with_its_id() {
    let files = serialize_workspace(&notes_snapshot(vec![note()]), &project()).files;
    let notes_prefix = at("notes/");
    let under_notes: Vec<&str> = files
        .iter()
        .map(|(p, _)| p.as_str())
        .filter(|p| p.starts_with(&notes_prefix))
        .collect();

    assert_eq!(under_notes, vec![at("notes/method.note.md").as_str()]);
    let content = files
        .iter()
        .find(|(p, _)| *p == at("notes/method.note.md"))
        .map(|(_, c)| c.as_str())
        .unwrap_or_default();
    assert!(content.contains("weaveforge-id: n1"));
}

// ------------------------------------------------------------------------ diff

#[test]
fn an_unchanged_folder_reports_no_writes() {
    let diff = diff_workspace(
        &parsed_from(&notes_snapshot(vec![note()])),
        &[existing()],
        None,
    );

    assert_eq!(diff.counts.unchanged, 1);
    assert_eq!(diff.counts.updated, 0);
}

#[test]
fn an_edited_body_is_an_update() {
    let edited = SnapshotVaultPage {
        body: "Edited.".to_owned(),
        ..note()
    };
    let diff = diff_workspace(
        &parsed_from(&notes_snapshot(vec![edited])),
        &[existing()],
        None,
    );

    assert_eq!(diff.counts.updated, 1);
    assert_eq!(diff.counts.unchanged, 0);
}

#[test]
fn an_unknown_id_is_a_creation_not_an_overwrite() {
    let elsewhere = SnapshotVaultPage {
        id: "elsewhere".to_owned(),
        ..note()
    };
    let diff = diff_workspace(&parsed_from(&notes_snapshot(vec![elsewhere])), &[], None);

    assert_eq!(diff.counts.created, 1);
    assert_eq!(diff.counts.updated, 0);
}

#[test]
fn an_id_claiming_a_different_entity_type_is_a_conflict_never_a_write() {
    // A crafted file naming an existing note's id but declaring itself a paper.
    let impostor = WorkspaceSnapshot {
        papers: vec![SnapshotPaper {
            id: "n1".to_owned(),
            title: "Impostor".to_owned(),
            ..SnapshotPaper::default()
        }],
        ..snapshot()
    };
    let diff = diff_workspace(&parsed_from(&impostor), &[existing()], None);

    assert_eq!(diff.counts.conflict, 1);
    assert_eq!(diff.counts.updated, 0);
    let reason = diff.entries[0].reason.as_deref().unwrap_or_default();
    assert!(reason.contains("belongs to a vault_page"), "{reason}");
}

#[test]
fn the_diff_never_reports_an_action_it_cannot_justify() {
    let snap = notes_snapshot(vec![
        note(),
        SnapshotVaultPage {
            id: "n2".to_owned(),
            title: "New".to_owned(),
            ..note()
        },
    ]);
    let diff = diff_workspace(&parsed_from(&snap), &[existing()], None);
    let c = &diff.counts;
    let total = c.created + c.updated + c.unchanged + c.conflict + c.removed;

    assert_eq!(diff.entries.len(), 2);
    assert_eq!(total, diff.entries.len());
}

// --------------------------------------------------------------------- ink note

#[test]
fn the_mirror_lifts_the_ink_header_into_frontmatter_and_folds_it_back_on_import() {
    let mut meta = default_ink_note_meta();
    meta.page_order = vec!["01JABCDEFGHJKMNPQRSTVWXYZ0".to_owned()];
    meta.recognised = 0.5;
    let ink = SnapshotVaultPage {
        id: "n1".to_owned(),
        title: "Ink".to_owned(),
        body: write_ink_note_body(&meta, "hello"),
        created_at: "2026-01-01T00:00:00Z".to_owned(),
        updated_at: "2026-01-01T00:00:00Z".to_owned(),
        ..SnapshotVaultPage::default()
    };
    let snap = WorkspaceSnapshot {
        vault_pages: vec![ink],
        collected_at: "2026-01-01T00:00:00Z".to_owned(),
        ..WorkspaceSnapshot::default()
    };
    let files = serialize_workspace(&snap, &project()).files;
    let (path, content) = files
        .iter()
        .find(|(p, _)| p.ends_with(".ink.md"))
        .unwrap_or_else(|| panic!("an ink note is written as .ink.md"));

    assert!(content.contains("weaveforge-type: ink_page"));
    assert!(content.contains("ink-page-order"));
    assert!(!content.contains("weaveforge-ink"), "header must not leak");

    let parsed = parse_workspace_file(path, content).unwrap_or_else(|| panic!("ink note parses"));
    assert_eq!(parsed.entity_type, WorkspaceEntityType::VaultPage);
    let (read_meta, text) = read_ink_note_body(&parsed.body);
    assert_eq!(read_meta, meta);
    assert_eq!(text, "hello");
}

//! `plan_mirror` must decide exactly what `mirror_workspace` does, so the web can read
//! and write the folder itself and leave the decisions to Rust.

#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use std::collections::HashMap;

use wf_core::sync::folder_layout::{WorkspaceProject, project_dir};
use wf_core::sync::folder_mirror::{
    MirrorOptions, MirrorResult, digest_map, mirror_workspace, plan_mirror,
};
use wf_core::sync::memory_fs::MemoryWorkspaceFs;
use wf_core::sync::serialize::serialize_workspace;
use wf_core::sync::workspace_fs::WorkspaceFs;
use wf_core::sync::workspace_snapshot::{SnapshotVaultPage, WorkspaceSnapshot};

fn thesis() -> WorkspaceProject {
    WorkspaceProject {
        id: "8d731734-bdcd-4f08-b648-efd15fdf75da".to_owned(),
        name: "MSc Thesis".to_owned(),
    }
}

/// A path inside the thesis project's folder.
fn at(path: &str) -> String {
    format!("{}/{path}", project_dir(&thesis()))
}

fn snapshot() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        collected_at: "2026-08-05T00:00:00.000Z".to_owned(),
        ..WorkspaceSnapshot::default()
    }
}

fn with_notes(pages: Vec<SnapshotVaultPage>) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        vault_pages: pages,
        ..snapshot()
    }
}

fn note(id: &str, title: &str, body: &str) -> SnapshotVaultPage {
    SnapshotVaultPage {
        id: id.to_owned(),
        title: title.to_owned(),
        body: body.to_owned(),
        created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-02-01T00:00:00.000Z".to_owned(),
        ..SnapshotVaultPage::default()
    }
}

fn options(project: &WorkspaceProject) -> MirrorOptions<'_> {
    MirrorOptions {
        project,
        seen: None,
        base: None,
        fetch_asset: None,
    }
}

/// The file's text, or empty when it is missing.
fn text<F: WorkspaceFs + ?Sized>(fs: &F, path: &str) -> String {
    fs.read_text(path).unwrap_or_default()
}

/// The in-session record a mirror leaves for the next one: path -> digest of the DB content.
fn seen_of(served: &[(String, String)]) -> HashMap<String, String> {
    served.iter().cloned().collect()
}

/// Runs both on the folder's current contents: the plan from read-only text, then the real
/// mirror. Returns (plan, mirror result) so each test can compare them and inspect either.
fn both(
    fs: &mut MemoryWorkspaceFs,
    input: &WorkspaceSnapshot,
    seen: Option<&HashMap<String, String>>,
    base: Option<&HashMap<String, String>>,
) -> (MirrorResult, MirrorResult) {
    let project = thesis();
    let serialized = serialize_workspace(input, &project);
    let mut disk = HashMap::new();
    for (path, _) in &serialized.files {
        if let Ok(text) = fs.read_text(path) {
            let _ = disk.insert(path.clone(), text);
        }
    }
    let plan = plan_mirror(&serialized.files, seen, base, &disk).expect("plan");
    let opts = MirrorOptions {
        seen,
        base,
        ..options(&project)
    };
    let mirrored = mirror_workspace(input, fs, opts).expect("mirror");
    (plan, mirrored)
}

#[test]
fn a_fresh_folder_plans_every_write() {
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![
        note("n1", "Method", "One"),
        note("n2", "Results", "Two"),
    ]);

    let (plan, mirrored) = both(&mut fs, &snap, None, None);

    assert_eq!(plan, mirrored);
    assert!(plan.written.contains(&at("notes/method.note.md")));
}

#[test]
fn an_unchanged_folder_plans_nothing() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "One")]);
    let first = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");

    let (plan, mirrored) = both(
        &mut fs,
        &snap,
        Some(&seen_of(&first.served)),
        Some(&digest_map(&first.mirrored)),
    );

    assert_eq!(plan, mirrored);
    assert!(plan.written.is_empty());
    assert!(plan.unchanged > 0);
}

#[test]
fn a_new_export_time_alone_plans_no_write() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let first_snap = WorkspaceSnapshot {
        collected_at: "2026-08-05T00:00:00.000Z".to_owned(),
        ..WorkspaceSnapshot::default()
    };
    let first = mirror_workspace(&first_snap, &mut fs, options(&project)).expect("first");
    let later_snap = WorkspaceSnapshot {
        collected_at: "2026-09-01T00:00:00.000Z".to_owned(),
        ..WorkspaceSnapshot::default()
    };

    let (plan, mirrored) = both(
        &mut fs,
        &later_snap,
        Some(&seen_of(&first.served)),
        Some(&digest_map(&first.mirrored)),
    );

    assert_eq!(plan, mirrored);
    assert!(!plan.written.contains(&"README.md".to_owned()));
}

#[test]
fn a_reader_edit_is_held_in_the_plan() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "One")]);
    let first = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    let path = at("notes/method.note.md");
    let edited = format!("{}\nA sentence the reader added.\n", text(&fs, &path));
    fs.write_file(&path, edited.as_bytes()).expect("edit");
    let changed = with_notes(vec![note("n1", "Method", "One changed in the app")]);

    let (plan, mirrored) = both(
        &mut fs,
        &changed,
        Some(&seen_of(&first.served)),
        Some(&digest_map(&first.mirrored)),
    );

    assert_eq!(plan, mirrored);
    assert_eq!(plan.held_back, vec![path]);
}

#[test]
fn a_departed_file_is_never_planned_for_removal() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "One"), note("n2", "Gone", "Bye")]);
    let first = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    let only_n1 = with_notes(vec![note("n1", "Method", "One")]);

    let (plan, mirrored) = both(
        &mut fs,
        &only_n1,
        Some(&seen_of(&first.served)),
        Some(&digest_map(&first.mirrored)),
    );

    assert_eq!(plan, mirrored);
    assert!(plan.removed.is_empty());
    assert!(!plan.written.contains(&at("notes/gone.note.md")));
}

#[test]
fn a_departed_but_edited_file_is_left_alone() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "One"), note("n2", "Gone", "Bye")]);
    let first = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    let path = at("notes/gone.note.md");
    let edited = format!("{}\nStill wanted.\n", text(&fs, &path));
    fs.write_file(&path, edited.as_bytes()).expect("edit");
    let only_n1 = with_notes(vec![note("n1", "Method", "One")]);

    let (plan, mirrored) = both(
        &mut fs,
        &only_n1,
        Some(&seen_of(&first.served)),
        Some(&digest_map(&first.mirrored)),
    );

    assert_eq!(plan, mirrored);
    assert!(plan.held_back.is_empty());
    assert!(plan.removed.is_empty());
}

#[test]
fn a_departed_file_without_base_is_never_removed() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "One"), note("n2", "Gone", "Bye")]);
    let first = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    let only_n1 = with_notes(vec![note("n1", "Method", "One")]);

    let (plan, mirrored) = both(&mut fs, &only_n1, Some(&seen_of(&first.served)), None);

    assert_eq!(plan, mirrored);
    assert!(plan.removed.is_empty());
    assert!(!plan.written.contains(&at("notes/gone.note.md")));
}

#[test]
fn an_asset_path_is_never_removed() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "![](vault:u1/n1/a.png)")]);
    let _ = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");

    let (plan, mirrored) = both(&mut fs, &with_notes(vec![]), None, None);

    assert_eq!(plan, mirrored);
    assert!(plan.removed.is_empty());
}

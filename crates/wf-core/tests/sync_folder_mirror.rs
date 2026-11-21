//! Ports of `packages/core/test/workspace/folder-mirror.test.ts`. The git cases in
//! that file belong to the git tests, not here.

#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use std::cell::RefCell;
use std::collections::HashMap;

use serde_json::json;
use wf_core::sync::change_origin::digest_text;
use wf_core::sync::folder_layout::{WorkspaceProject, project_dir};
use wf_core::sync::folder_mirror::{MirrorOptions, digest_map, mirror_workspace};
use wf_core::sync::json_entities::JsonRow;
use wf_core::sync::memory_fs::MemoryWorkspaceFs;
use wf_core::sync::workspace_fs::{FsError, WorkspaceFs, WorkspaceStat};
use wf_core::sync::workspace_snapshot::{SnapshotVaultPage, WorkspaceSnapshot};

const NOW: &str = "2026-08-05T00:00:00.000Z";

fn thesis() -> WorkspaceProject {
    WorkspaceProject {
        id: "8d731734-bdcd-4f08-b648-efd15fdf75da".to_owned(),
        name: "MSc Thesis".to_owned(),
    }
}

fn offline() -> WorkspaceProject {
    WorkspaceProject {
        id: "00000000-0000-4000-8000-0000000000aa".to_owned(),
        name: "Offline Trial".to_owned(),
    }
}

/// A path inside the thesis project's folder.
fn at(path: &str) -> String {
    format!("{}/{path}", project_dir(&thesis()))
}

fn snapshot() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        collected_at: NOW.to_owned(),
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

fn row(id: &str) -> JsonRow {
    json!({ "id": id }).as_object().cloned().unwrap_or_default()
}

/// The in-session record a mirror leaves for the next one: path -> digest of the DB content.
fn seen_of(served: &[(String, String)]) -> HashMap<String, String> {
    served.iter().cloned().collect()
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

/// Counts the stats and reads the mirror makes per path.
struct CountingFs {
    inner: MemoryWorkspaceFs,
    stats: RefCell<HashMap<String, usize>>,
    reads: RefCell<HashMap<String, usize>>,
}

impl CountingFs {
    fn new() -> Self {
        Self {
            inner: MemoryWorkspaceFs::new(),
            stats: RefCell::default(),
            reads: RefCell::default(),
        }
    }

    fn reset(&self) {
        self.stats.borrow_mut().clear();
        self.reads.borrow_mut().clear();
    }

    fn stats_of(&self, path: &str) -> usize {
        self.stats.borrow().get(path).copied().unwrap_or(0)
    }

    fn reads_of(&self, path: &str) -> usize {
        self.reads.borrow().get(path).copied().unwrap_or(0)
    }
}

fn bump(counts: &RefCell<HashMap<String, usize>>, path: &str) {
    *counts.borrow_mut().entry(path.to_owned()).or_insert(0) += 1;
}

impl WorkspaceFs for CountingFs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, FsError> {
        self.inner.read_file(path)
    }

    fn read_text(&self, path: &str) -> Result<String, FsError> {
        bump(&self.reads, path);
        self.inner.read_text(path)
    }

    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), FsError> {
        self.inner.write_file(path, data)
    }

    fn remove(&mut self, path: &str, recursive: bool) -> Result<(), FsError> {
        self.inner.remove(path, recursive)
    }

    fn mkdirp(&mut self, path: &str) -> Result<(), FsError> {
        self.inner.mkdirp(path)
    }

    fn list(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        self.inner.list(dir)
    }

    fn walk(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        self.inner.walk(dir)
    }

    fn stat(&self, path: &str) -> Option<WorkspaceStat> {
        bump(&self.stats, path);
        self.inner.stat(path)
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError> {
        self.inner.rename(from, to)
    }
}

/// Delegates to a memory filesystem, failing writes or removes on request.
struct FailingFs {
    inner: MemoryWorkspaceFs,
    fail_writes: bool,
    fail_removes: bool,
}

impl WorkspaceFs for FailingFs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, FsError> {
        self.inner.read_file(path)
    }

    fn read_text(&self, path: &str) -> Result<String, FsError> {
        self.inner.read_text(path)
    }

    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), FsError> {
        if self.fail_writes {
            return Err(FsError::Io("disk full".to_owned()));
        }
        self.inner.write_file(path, data)
    }

    fn remove(&mut self, path: &str, recursive: bool) -> Result<(), FsError> {
        if self.fail_removes {
            return Err(FsError::Io("permission denied".to_owned()));
        }
        self.inner.remove(path, recursive)
    }

    fn mkdirp(&mut self, path: &str) -> Result<(), FsError> {
        self.inner.mkdirp(path)
    }

    fn list(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        self.inner.list(dir)
    }

    fn walk(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        self.inner.walk(dir)
    }

    fn stat(&self, path: &str) -> Option<WorkspaceStat> {
        self.inner.stat(path)
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError> {
        self.inner.rename(from, to)
    }
}

#[test]
fn a_first_mirror_writes_the_whole_folder() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "")]);

    let result = mirror_workspace(&snap, &mut fs, options(&project)).expect("mirror");

    assert!(result.written.contains(&at("notes/method.note.md")));
    assert_eq!(result.unchanged, 0);
}

#[test]
fn mirroring_twice_writes_nothing_the_second_time() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "Body")]);

    let _ = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    let second = mirror_workspace(&snap, &mut fs, options(&project)).expect("second");

    // Determinism is what makes this possible, and it is what stops git filling
    // with commits full of untouched files.
    assert!(second.written.is_empty());
    assert!(second.unchanged > 0);
}

#[test]
fn a_later_run_with_nothing_new_writes_nothing_though_the_clock_moved() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "Body")]);
    let first = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");

    let moved = WorkspaceSnapshot {
        collected_at: "2026-08-06T00:00:00.000Z".to_owned(),
        ..snap.clone()
    };
    let second = mirror_workspace(&moved, &mut fs, options(&project)).expect("second");

    // A timestamp alone in README and manifest made a git commit every run.
    assert!(second.written.is_empty());
    assert_eq!(second.mirrored, first.mirrored);
}

#[test]
fn an_edit_rewrites_only_the_file_that_changed() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let first = mirror_workspace(
        &with_notes(vec![
            note("n1", "Method", "One"),
            note("n2", "Other", "Two"),
        ]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);

    let result = mirror_workspace(
        &with_notes(vec![
            note("n1", "Method", "Edited"),
            note("n2", "Other", "Two"),
        ]),
        &mut fs,
        MirrorOptions {
            seen: Some(&seen),
            ..options(&project)
        },
    )
    .expect("second");

    assert_eq!(result.written, vec![at("notes/method.note.md")]);
}

#[test]
fn sync_never_deletes_a_file_the_snapshot_no_longer_holds() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", ""), note("n2", "Gone", "")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);

    let result = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "")]),
        &mut fs,
        MirrorOptions {
            seen: Some(&seen),
            ..options(&project)
        },
    )
    .expect("second");

    // Deleting from the folder lost data when the DB was partial or fresh. Only the
    // user deletes files; the mirror keeps every file it wrote.
    assert!(result.removed.is_empty());
    assert!(fs.stat(&at("notes/gone.note.md")).is_some());
}

#[test]
fn files_the_mirror_does_not_own_are_left_alone() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    fs.write_file(".obsidian/workspace.json", b"{}")
        .expect("seed");
    fs.write_file(&at("notes/my-own-file.md"), b"Written by hand.")
        .expect("seed");

    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    let opts = MirrorOptions {
        seen: Some(&seen),
        ..options(&project)
    };
    let _ = mirror_workspace(&snapshot(), &mut fs, opts).expect("second");

    // Deleting unrecognised files in a folder the user can see would be an
    // unpleasant surprise the first time it happened.
    assert!(fs.stat(".obsidian/workspace.json").is_some());
    assert!(fs.stat(&at("notes/my-own-file.md")).is_some());
}

/// The regression this whole change exists for: a second project's run must not
/// remove the first project's files, because each manifest names only its own.
#[test]
fn mirroring_a_second_project_leaves_the_first_projects_files_alone() {
    let project = thesis();
    let other = offline();
    let mut fs = MemoryWorkspaceFs::new();

    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Thesis method", "")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let thesis_file = at("notes/thesis-method.note.md");
    assert!(fs.stat(&thesis_file).is_some());

    // A run for the other project, with its own manifest: empty, because this is
    // its first run. Same folder, same filesystem.
    let second = mirror_workspace(
        &with_notes(vec![note("n2", "Trial notes", "")]),
        &mut fs,
        options(&other),
    )
    .expect("second");

    let trial = format!("{}/notes/trial-notes.note.md", project_dir(&other));
    assert!(
        fs.stat(&thesis_file).is_some(),
        "the first project's note is still on disk"
    );
    assert!(fs.stat(&trial).is_some());
    assert!(!second.removed.contains(&thesis_file));
    assert!(!first.written.contains(&trial));
}

#[test]
fn each_projects_bookkeeping_is_its_own() {
    let project = thesis();
    let other = offline();
    let mut fs = MemoryWorkspaceFs::new();

    let _ = mirror_workspace(
        &WorkspaceSnapshot {
            relations: vec![row("r1")],
            tags: vec![row("t1")],
            ..snapshot()
        },
        &mut fs,
        options(&project),
    )
    .expect("first");
    let _ = mirror_workspace(&snapshot(), &mut fs, options(&other)).expect("second");

    let thesis_relations = text(&fs, &at(".weaveforge/relations.json"));
    let offline_relations = text(
        &fs,
        &format!("{}/.weaveforge/relations.json", project_dir(&other)),
    );

    assert!(
        thesis_relations.contains("r1"),
        "the first project keeps its edges"
    );
    assert!(
        !offline_relations.contains("r1"),
        "and the second project does not inherit them"
    );
}

#[test]
fn assets_are_fetched_once_and_not_re_downloaded() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "![](vault:u1/n1/a.png)")]);
    let mut fetches = 0;
    let mut fetch = |_: &str| -> Option<Vec<u8>> {
        fetches += 1;
        Some(vec![1, 2, 3])
    };

    let opts = MirrorOptions {
        fetch_asset: Some(&mut fetch),
        ..options(&project)
    };
    let _ = mirror_workspace(&snap, &mut fs, opts).expect("first");
    let opts = MirrorOptions {
        fetch_asset: Some(&mut fetch),
        ..options(&project)
    };
    let _ = mirror_workspace(&snap, &mut fs, opts).expect("second");

    assert_eq!(
        fetches, 1,
        "storage paths carry a uuid, so an existing asset is the same file"
    );
    // Assets stay shared at the top of the folder: one tree, so a body's relative
    // links resolve from anywhere inside it.
    assert!(fs.stat("assets/notes/u1/n1/a.png").is_some());
}

#[test]
fn a_missing_asset_does_not_abort_the_mirror() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "![](vault:u1/n1/gone.png)")]);
    let mut nothing = |_: &str| -> Option<Vec<u8>> { None };

    let opts = MirrorOptions {
        fetch_asset: Some(&mut nothing),
        ..options(&project)
    };
    let result = mirror_workspace(&snap, &mut fs, opts).expect("mirror");

    assert!(
        result.written.contains(&at("notes/method.note.md")),
        "the note is still written"
    );
    assert!(!result.written.iter().any(|path| path.ends_with("gone.png")));
    let on_disk = fs.walk("").expect("walk");
    assert!(!on_disk.iter().any(|entry| entry.path.ends_with("gone.png")));
}

/// A file the reader edited belongs to the reader: left alone and reported.
#[test]
fn a_file_edited_since_the_last_mirror_is_left_alone_and_reported() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "One")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    let path = at("notes/method.note.md");
    assert!(first.written.contains(&path));

    // Somebody edits it in the folder.
    let edited = format!("{}\nA sentence the reader added.\n", text(&fs, &path));
    fs.write_file(&path, edited.as_bytes()).expect("edit");

    let base = digest_map(&first.mirrored);
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&base),
        ..options(&project)
    };
    let second = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "One changed in the app")]),
        &mut fs,
        opts,
    )
    .expect("second");

    assert_eq!(text(&fs, &path), edited, "the folder's copy is untouched");
    assert_eq!(second.held_back, vec![path.clone()]);
    assert!(
        second.written.is_empty(),
        "and it is not reported as written"
    );
    assert!(second.removed.is_empty(), "nor as removed");
}

#[test]
fn a_file_the_mirror_never_wrote_is_still_written_beside_and_nothing_is_held() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    // A note dropped in by hand: no base digest, so the mirror owns nothing here.
    fs.write_file(
        &at("notes/dropped.note.md"),
        b"typed straight into the folder",
    )
    .expect("seed");

    let base = HashMap::new();
    let opts = MirrorOptions {
        base: Some(&base),
        ..options(&project)
    };
    let result = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "One")]),
        &mut fs,
        opts,
    )
    .expect("mirror");

    assert!(result.held_back.is_empty());
    assert!(
        fs.stat(&at("notes/dropped.note.md")).is_some(),
        "the reader's file is left where it is"
    );
    assert!(result.written.contains(&at("notes/method.note.md")));
}

#[test]
fn an_edited_file_whose_entity_left_the_workspace_is_left_untouched() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", ""), note("n2", "Gone", "")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    let gone = at("notes/gone.note.md");
    let edited = format!("{}\nStill wanted.\n", text(&fs, &gone));
    fs.write_file(&gone, edited.as_bytes()).expect("edit");

    // The note is deleted in the app; the folder's copy was edited first.
    let base = digest_map(&first.mirrored);
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&base),
        ..options(&project)
    };
    let second = mirror_workspace(&with_notes(vec![note("n1", "Method", "")]), &mut fs, opts)
        .expect("second");

    assert_eq!(
        text(&fs, &gone),
        edited,
        "a deletion does not take an edit with it"
    );
    // Sync no longer visits departed files, so there is nothing to hold or remove.
    assert!(second.held_back.is_empty());
    assert!(second.removed.is_empty());
}

#[test]
fn an_edit_the_import_has_applied_no_longer_holds_the_mirror_back() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "One")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    let path = at("notes/method.note.md");
    fs.write_file(&path, b"the reader's version").expect("edit");

    // The import applies that edit: the workspace now holds what the folder holds.
    let base = digest_map(&first.mirrored);
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&base),
        ..options(&project)
    };
    let applied = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "the reader's version")]),
        &mut fs,
        opts,
    )
    .expect("applied");
    assert_eq!(
        applied.held_back,
        vec![path.clone()],
        "held while the two sides disagree"
    );

    // Applying an edit through the import records the folder's text as the base:
    // the digest is the one the file now has, not the one the app would have written.
    let mut agreed_base = digest_map(&first.mirrored);
    let _ = agreed_base.insert(path.clone(), digest_text(&text(&fs, &path)));
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&agreed_base),
        ..options(&project)
    };
    let agreed = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "the reader's version")]),
        &mut fs,
        opts,
    )
    .expect("agreed");

    assert!(
        agreed.held_back.is_empty(),
        "nothing is held back once the edit has been applied"
    );
    assert!(
        agreed.written.contains(&path),
        "and the app's version is written normally again"
    );
}

#[test]
fn the_same_protection_covers_the_projects_json_data_files() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let first = mirror_workspace(
        &WorkspaceSnapshot {
            relations: vec![row("r1")],
            ..snapshot()
        },
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    let path = at(".weaveforge/relations.json");
    assert!(first.written.contains(&path));

    // An edge added by hand, in the file the mirror writes.
    let trimmed = text(&fs, &path).trim().to_owned();
    let edited = format!("{trimmed}\n").replacen("]", "  { \"id\": \"r2\" }\n]", 1);
    fs.write_file(&path, edited.as_bytes()).expect("edit");

    let base = digest_map(&first.mirrored);
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&base),
        ..options(&project)
    };
    let second = mirror_workspace(
        &WorkspaceSnapshot {
            relations: vec![row("r1"), row("r3")],
            ..snapshot()
        },
        &mut fs,
        opts,
    )
    .expect("second");

    assert_eq!(second.held_back, vec![path.clone()]);
    assert!(
        text(&fs, &path).contains("r2"),
        "the hand-added edge survives the sync"
    );
}

#[test]
fn the_mirror_never_reaches_into_a_strokes_folder() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    // A page of somebody's handwriting beside its note, written by the ink store
    // rather than by the mirror, which is the whole reason this holds.
    let ink_dir = at("notes/method.ink");
    let ink_path = format!("{ink_dir}/01JCHUNK0000000000000000.inkb");
    fs.mkdirp(&ink_dir).expect("mkdir");
    fs.write_file(&ink_path, &[1_u8, 2, 3]).expect("ink");

    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    assert!(first.written.iter().all(|path| !path.starts_with(&ink_dir)));

    // The note goes; the strokes stay. Sync never deletes, so neither the note nor a
    // chunk is removed.
    let opts = MirrorOptions {
        seen: Some(&seen),
        ..options(&project)
    };
    let second = mirror_workspace(&snapshot(), &mut fs, opts).expect("second");
    assert!(second.removed.is_empty());
    assert!(fs.stat(&at("notes/method.note.md")).is_some());
    assert!(fs.stat(&ink_path).is_some());
}

#[test]
fn the_root_readme_rewritten_by_another_projects_mirror_is_not_held_back() {
    let project = thesis();
    let other = WorkspaceProject {
        id: "407c3746-13be-4230-bdfa-47c065d7c189".to_owned(),
        name: "Offline Trial".to_owned(),
    };
    let mut fs = MemoryWorkspaceFs::new();
    let first = mirror_workspace(&snapshot(), &mut fs, options(&project)).expect("first");
    let seen = seen_of(&first.served);
    let _ = mirror_workspace(
        &WorkspaceSnapshot {
            collected_at: "2026-08-06T00:00:00.000Z".to_owned(),
            ..snapshot()
        },
        &mut fs,
        options(&other),
    )
    .expect("other");

    let base = digest_map(&first.mirrored);
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&base),
        ..options(&project)
    };
    let second = mirror_workspace(
        &WorkspaceSnapshot {
            collected_at: "2026-08-07T00:00:00.000Z".to_owned(),
            ..snapshot()
        },
        &mut fs,
        opts,
    )
    .expect("second");

    assert!(second.held_back.is_empty());
    // Only the export time differs, so it is not rewritten either.
    assert!(!second.written.contains(&"README.md".to_owned()));
}

#[test]
fn an_unchanged_file_costs_one_read_and_no_stat() {
    let project = thesis();
    let mut fs = CountingFs::new();
    let snap = with_notes(vec![note("n1", "Method", "Body")]);
    let _ = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    fs.reset();

    let second = mirror_workspace(&snap, &mut fs, options(&project)).expect("second");

    let path = at("notes/method.note.md");
    assert!(second.written.is_empty());
    assert_eq!(fs.stats_of(&path), 0);
    assert_eq!(fs.reads_of(&path), 1);
}

#[test]
fn a_readers_edit_is_held_back_on_the_one_read_it_took_to_see_it() {
    let project = thesis();
    let mut fs = CountingFs::new();
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "One")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    let path = at("notes/method.note.md");
    let edited = format!("{}\nThe reader's line.\n", text(&fs, &path));
    fs.write_file(&path, edited.as_bytes()).expect("edit");
    fs.reset();

    let base = digest_map(&first.mirrored);
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&base),
        ..options(&project)
    };
    let second = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "Two")]),
        &mut fs,
        opts,
    )
    .expect("second");

    assert_eq!(second.held_back, vec![path.clone()]);
    assert_eq!(text(&fs, &path), edited);
    assert_eq!(fs.stats_of(&path), 0);
    assert_eq!(
        fs.reads_of(&path),
        2,
        "one by the mirror, one by this assertion"
    );
}

#[test]
fn a_reader_edit_with_no_base_entry_is_held_back_not_overwritten() {
    let project = thesis();
    let mut fs = CountingFs::new();
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "One")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    let path = at("notes/method.note.md");
    let edited = format!("{}\nThe reader's line.\n", text(&fs, &path));
    fs.write_file(&path, edited.as_bytes()).expect("edit");

    // No base entry for the path, but this process saw the item change in the DB: the reader's
    // on-disk copy must be held, not overwritten.
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: None,
        ..options(&project)
    };
    let second = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "Two")]),
        &mut fs,
        opts,
    )
    .expect("second");

    assert_eq!(second.held_back, vec![path.clone()]);
    assert_eq!(text(&fs, &path), edited);
}

#[test]
fn a_file_that_is_gone_or_cannot_be_read_is_written() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "Body")]);
    let first = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    let seen = seen_of(&first.served);
    let path = at("notes/method.note.md");
    fs.remove(&path, false).expect("remove");

    let base = digest_map(&first.mirrored);
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&base),
        ..options(&project)
    };
    let second = mirror_workspace(&snap, &mut fs, opts).expect("second");

    assert!(second.written.contains(&path));
    assert!(text(&fs, &path).contains("Body"));
}

#[test]
fn a_readme_differing_only_in_its_export_time_is_unchanged() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let _ = mirror_workspace(&snapshot(), &mut fs, options(&project)).expect("first");
    let readme = text(&fs, "README.md");
    fs.write_file(
        "README.md",
        readme
            .replacen(NOW, "1999-01-01T00:00:00.000Z", 1)
            .as_bytes(),
    )
    .expect("edit");

    let second = mirror_workspace(&snapshot(), &mut fs, options(&project)).expect("second");

    assert!(!second.written.contains(&"README.md".to_owned()));
    assert!(
        text(&fs, "README.md").contains("1999-01-01"),
        "the edited copy is not rewritten"
    );
}

#[test]
fn a_manifest_whose_generated_at_alone_changed_is_unchanged() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let _ = mirror_workspace(&snapshot(), &mut fs, options(&project)).expect("first");
    let manifest = at(".weaveforge/manifest.json");
    let stamped = text(&fs, &manifest).replacen(NOW, "1999-01-01T00:00:00.000Z", 1);
    fs.write_file(&manifest, stamped.as_bytes()).expect("edit");

    let second = mirror_workspace(&snapshot(), &mut fs, options(&project)).expect("second");

    assert!(!second.written.contains(&manifest));
    assert!(
        text(&fs, &manifest).contains("1999-01-01"),
        "the edited copy is not rewritten"
    );
}

#[test]
fn a_note_with_an_export_line_is_left_alone_without_an_in_session_edit() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "Body")]);
    let _ = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    let path = at("notes/method.note.md");
    let original = text(&fs, &path);
    fs.write_file(&path, format!("{original}\nExported x.\n").as_bytes())
        .expect("edit");

    let second = mirror_workspace(&snap, &mut fs, options(&project)).expect("second");

    assert!(!second.written.contains(&path));
    assert!(text(&fs, &path).contains("Exported x."));
}

#[test]
fn a_write_failure_propagates() {
    let project = thesis();
    let mut fs = FailingFs {
        inner: MemoryWorkspaceFs::new(),
        fail_writes: true,
        fail_removes: false,
    };

    let result = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "")]),
        &mut fs,
        options(&project),
    );

    assert_eq!(result, Err(FsError::Io("disk full".to_owned())));
}

#[test]
fn a_departed_file_is_left_in_place_and_no_remove_is_attempted() {
    let project = thesis();
    let mut fs = FailingFs {
        inner: MemoryWorkspaceFs::new(),
        fail_writes: false,
        fail_removes: false,
    };
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", ""), note("n2", "Gone", "")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    fs.fail_removes = true;

    let opts = MirrorOptions {
        seen: Some(&seen),
        ..options(&project)
    };
    let result = mirror_workspace(&with_notes(vec![note("n1", "Method", "")]), &mut fs, opts)
        .expect("a failed remove is not a failed mirror");

    assert!(result.removed.is_empty());
    assert!(
        fs.inner.stat(&at("notes/gone.note.md")).is_some(),
        "sync never removes a departed file"
    );
}

/// Fresh or partial DB bytes must never rewrite a file the user already has: the first
/// mirror after start has no in-session record, so an existing file stays byte-identical.
#[test]
fn a_first_mirror_after_start_never_rewrites_an_existing_file() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let old = b"---\nweaveforge-id: old-id\ncreated-at: 2020-01-01\n---\nOld body\n";
    fs.write_file(&at("notes/method.note.md"), old)
        .expect("seed");

    let result = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "Fresh body")]),
        &mut fs,
        options(&project),
    )
    .expect("mirror");

    assert!(!result.written.contains(&at("notes/method.note.md")));
    assert_eq!(
        fs.read_file(&at("notes/method.note.md")).expect("read"),
        old.to_vec()
    );
}

/// An item the DB did not change in this session keeps its file bytes even when the
/// file differs from the DB rendering.
#[test]
fn an_item_unchanged_in_session_keeps_its_file_bytes() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let snap = with_notes(vec![note("n1", "Method", "Body")]);
    let first = mirror_workspace(&snap, &mut fs, options(&project)).expect("first");
    let seen = seen_of(&first.served);
    let other = b"Hand-edited elsewhere.\n";
    fs.write_file(&at("notes/method.note.md"), other)
        .expect("seed");

    let result = mirror_workspace(
        &snap,
        &mut fs,
        MirrorOptions {
            seen: Some(&seen),
            ..options(&project)
        },
    )
    .expect("second");

    assert!(result.written.is_empty());
    assert_eq!(
        fs.read_file(&at("notes/method.note.md")).expect("read"),
        other.to_vec()
    );
}

/// Delegates to a memory filesystem, but cannot read one path although it exists.
struct UnreadableFs {
    inner: MemoryWorkspaceFs,
    unreadable: String,
}

impl WorkspaceFs for UnreadableFs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, FsError> {
        self.inner.read_file(path)
    }

    fn read_text(&self, path: &str) -> Result<String, FsError> {
        if path == self.unreadable {
            return Err(FsError::Io("locked by another process".to_owned()));
        }
        self.inner.read_text(path)
    }

    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), FsError> {
        self.inner.write_file(path, data)
    }

    fn remove(&mut self, path: &str, recursive: bool) -> Result<(), FsError> {
        self.inner.remove(path, recursive)
    }

    fn mkdirp(&mut self, path: &str) -> Result<(), FsError> {
        self.inner.mkdirp(path)
    }

    fn list(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        self.inner.list(dir)
    }

    fn walk(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        self.inner.walk(dir)
    }

    fn stat(&self, path: &str) -> Option<WorkspaceStat> {
        self.inner.stat(path)
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError> {
        self.inner.rename(from, to)
    }
}

#[test]
fn an_existing_file_that_cannot_be_read_is_never_overwritten() {
    let project = thesis();
    let mut mem = MemoryWorkspaceFs::new();
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "Body")]),
        &mut mem,
        options(&project),
    )
    .expect("first");
    let seen = seen_of(&first.served);
    let base = digest_map(&first.mirrored);
    let path = at("notes/method.note.md");
    let on_disk = mem.read_text(&path).expect("on disk");

    // The user's copy is still there; only the read fails. The DB changed in-app this session.
    let mut fs = UnreadableFs {
        inner: mem,
        unreadable: path.clone(),
    };
    let edited = with_notes(vec![note("n1", "Method", "Edited in app")]);
    let opts = MirrorOptions {
        seen: Some(&seen),
        base: Some(&base),
        ..options(&project)
    };
    let second = mirror_workspace(&edited, &mut fs, opts).expect("second");

    assert!(
        !second.written.contains(&path),
        "an unreadable existing file must not be written"
    );
    assert_eq!(fs.inner.read_text(&path).expect("still there"), on_disk);
}

#[test]
fn a_reader_edit_seen_by_a_skipped_mirror_still_holds_back_a_later_in_app_edit() {
    let project = thesis();
    let mut fs = MemoryWorkspaceFs::new();
    let path = at("notes/method.note.md");

    // Run 1: the mirror writes the note as the DB holds it.
    let first = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "Body")]),
        &mut fs,
        options(&project),
    )
    .expect("first");
    // The reader edits the file outside the app.
    fs.write_file(&path, b"Reader edit").expect("reader edit");

    // Run 2: DB unchanged this session, so the file is skipped. Its base must stay the
    // last text the mirror wrote, not the reader's text.
    let seen_1 = seen_of(&first.served);
    let base_1 = digest_map(&first.mirrored);
    let skipped = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "Body")]),
        &mut fs,
        MirrorOptions {
            seen: Some(&seen_1),
            base: Some(&base_1),
            ..options(&project)
        },
    )
    .expect("skipped");
    assert!(!skipped.written.contains(&path));
    assert_eq!(text(&fs, &path), "Reader edit");

    // Run 3: an in-app edit this session. The reader's text must hold the mirror back.
    let seen_2 = seen_of(&skipped.served);
    let base_2 = digest_map(&skipped.mirrored);
    let edited = mirror_workspace(
        &with_notes(vec![note("n1", "Method", "Edited in app")]),
        &mut fs,
        MirrorOptions {
            seen: Some(&seen_2),
            base: Some(&base_2),
            ..options(&project)
        },
    )
    .expect("edited");
    assert!(
        edited.held_back.contains(&path),
        "reader's edit must be held, not overwritten"
    );
    assert_eq!(text(&fs, &path), "Reader edit");
}

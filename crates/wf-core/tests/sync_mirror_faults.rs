//! Seeded fault simulation of the folder mirror. Writes and removes fail partway
//! through a run and assets go missing at random. Two properties must hold:
//! (1) a clean rerun after an interrupted run converges to exactly the folder a
//! clean run produces; (2) a reader's edit to a mirrored file is never lost to a
//! write or remove fault. Read faults are out of scope: like the TS, the mirror
//! treats any read error as a missing file (plan §10).
//! Seeds are random unless `PROPTEST_RNG_SEED` is set; a failing case is saved to
//! the regressions file and replays from it.

// Golden-reading helpers and proptest bodies use expect/unwrap on fixed inputs.
#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use std::collections::{BTreeSet, HashMap};

use proptest::prelude::*;
use wf_core::sync::folder_layout::WorkspaceProject;
use wf_core::sync::folder_mirror::{MirrorOptions, MirrorResult, digest_map, mirror_workspace};
use wf_core::sync::json_entities::is_app_owned_path;
use wf_core::sync::memory_fs::MemoryWorkspaceFs;
use wf_core::sync::workspace_fs::{FsError, WorkspaceFs, WorkspaceStat};
use wf_core::sync::workspace_snapshot::{SnapshotVaultPage, WorkspaceSnapshot};

const NOW: &str = "2026-08-05T00:00:00.000Z";
const IDS: [&str; 8] = ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"];
const TITLES: [&str; 3] = ["Alpha", "Beta", "Gamma"];

fn project() -> WorkspaceProject {
    WorkspaceProject {
        id: "8d731734-bdcd-4f08-b648-efd15fdf75da".to_owned(),
        name: "MSc Thesis".to_owned(),
    }
}

fn snapshot_of(vault_pages: Vec<SnapshotVaultPage>) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        vault_pages,
        collected_at: NOW.to_owned(),
        ..WorkspaceSnapshot::default()
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

/// A workspace fs whose `write_file` and `remove` calls fail on one chosen op.
struct FaultyFs {
    inner: MemoryWorkspaceFs,
    fail_at: Option<usize>,
    ops: usize,
}

impl FaultyFs {
    /// Counts a write or remove; fails it when it is the chosen op, before any change.
    fn tick(&mut self) -> Result<(), FsError> {
        self.ops += 1;
        if self.fail_at == Some(self.ops) {
            return Err(FsError::Io("injected".into()));
        }
        Ok(())
    }
}

impl WorkspaceFs for FaultyFs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, FsError> {
        self.inner.read_file(path)
    }

    fn read_text(&self, path: &str) -> Result<String, FsError> {
        self.inner.read_text(path)
    }

    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), FsError> {
        self.tick()?;
        self.inner.write_file(path, data)
    }

    fn remove(&mut self, path: &str, recursive: bool) -> Result<(), FsError> {
        self.tick()?;
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

fn fresh() -> FaultyFs {
    FaultyFs {
        inner: MemoryWorkspaceFs::with_clock(Box::new(|| 0)),
        fail_at: None,
        ops: 0,
    }
}

/// Runs the mirror. The i-th asset fetch returns `None` when `fetch_flags[i]` is false;
/// calls past the end of `fetch_flags` succeed, so `&[]` is a clean fetch.
fn mirror(
    fs: &mut FaultyFs,
    snapshot: &WorkspaceSnapshot,
    previous: &[String],
    base: Option<&HashMap<String, String>>,
    fetch_flags: &[bool],
) -> Result<MirrorResult, FsError> {
    let project = project();
    let mut calls = 0usize;
    let mut fetch = |_: &str| {
        let ok = fetch_flags.get(calls).copied().unwrap_or(true);
        calls += 1;
        ok.then(|| b"png".to_vec())
    };
    let options = MirrorOptions {
        project: &project,
        previous_paths: previous,
        base,
        fetch_asset: Some(&mut fetch),
    };
    mirror_workspace(snapshot, fs, options)
}

/// The op to fail: one of the `total` writes and removes the faulty run will make,
/// so every case injects a fault. `None` when the run makes no op at all.
fn pick_op(total: usize, seed: usize) -> Option<usize> {
    (total > 0).then(|| 1 + seed % total)
}

/// A mirrored folder with one note overwritten by a reader.
struct Edited {
    fs: FaultyFs,
    /// The first run's paths.
    previous: Vec<String>,
    /// The first run's digest map.
    base: HashMap<String, String>,
    /// The note the reader edited.
    path: String,
}

/// A folder mirrored from `before`, with one non-app note overwritten by a reader.
fn edited_folder(before: &WorkspaceSnapshot, pick: usize) -> Option<Edited> {
    let mut fs = fresh();
    let first = mirror(&mut fs, before, &[], None, &[]).expect("clean run");
    let notes: Vec<String> = first
        .written
        .iter()
        .filter(|path| path.ends_with(".md") && !is_app_owned_path(path))
        .cloned()
        .collect();
    if notes.is_empty() {
        return None;
    }
    let edited = notes[pick % notes.len()].clone();
    fs.inner
        .write_file(&edited, "reader edit\n".as_bytes())
        .expect("edit on disk");
    Some(Edited {
        fs,
        previous: departed(&first),
        base: digest_map(&first.mirrored),
        path: edited,
    })
}

/// Every path a run may have left behind: mirrored keys plus written files, deduped.
fn departed(first: &MirrorResult) -> Vec<String> {
    let paths: BTreeSet<String> = first
        .mirrored
        .iter()
        .map(|(path, _)| path.clone())
        .chain(first.written.iter().cloned())
        .collect();
    paths.into_iter().collect()
}

fn body(id: &str, kind: u8) -> String {
    match kind {
        0 => "plain body\n".to_owned(),
        1 => format!("![](vault:u1/{id}/a.png)\n"),
        _ => format!("edited {id}\n![](vault:u1/{id}/a.png)\n"),
    }
}

/// 1..6 notes with unique ids from `IDS`, titles from `TITLES`, and bodies that
/// sometimes reference an asset at `u1/<id>/a.png`.
fn pages() -> impl Strategy<Value = Vec<SnapshotVaultPage>> {
    proptest::sample::subsequence(IDS.to_vec(), 1..6)
        .prop_flat_map(|ids| {
            let n = ids.len();
            (
                Just(ids),
                proptest::collection::vec((0..TITLES.len(), 0u8..3), n),
            )
        })
        .prop_map(|(ids, specs)| {
            ids.iter()
                .zip(specs)
                .map(|(id, (title, kind))| note(id, TITLES[title], &body(id, kind)))
                .collect()
        })
}

proptest! {
    #![proptest_config(ProptestConfig::default())]

    #[test]
    fn interrupted_mirror_converges_after_clean_rerun(
        before in pages(),
        after in pages(),
        flags in proptest::collection::vec(any::<bool>(), 8),
        seed in any::<usize>(),
    ) {
        let before = snapshot_of(before);
        let after = snapshot_of(after);

        let mut reference = fresh();
        let first = mirror(&mut reference, &before, &[], None, &[]).expect("clean run");
        let previous = departed(&first);
        let _ = mirror(&mut reference, &after, &previous, None, &[]).expect("clean run");
        let expected = reference.inner.to_record();

        let mut counted = fresh();
        let _ = mirror(&mut counted, &before, &[], None, &[]).expect("clean run");
        counted.ops = 0;
        let _ = mirror(&mut counted, &after, &previous, None, &flags).expect("counting run");
        let Some(fail_at) = pick_op(counted.ops, seed) else {
            return Ok(());
        };

        let mut faulty = fresh();
        let _ = mirror(&mut faulty, &before, &[], None, &[]).expect("clean run");
        faulty.fail_at = Some(fail_at);
        faulty.ops = 0;
        let _ = mirror(&mut faulty, &after, &previous, None, &flags);
        prop_assert!(faulty.ops >= fail_at, "fault {} never fired", fail_at);
        faulty.fail_at = None;
        let _ = mirror(&mut faulty, &after, &previous, None, &[]).expect("clean rerun");

        prop_assert_eq!(faulty.inner.to_record(), expected);
    }

    #[test]
    fn reader_edit_is_never_lost(
        before in pages(),
        after in pages(),
        flags in proptest::collection::vec(any::<bool>(), 8),
        seed in any::<usize>(),
        pick in any::<usize>(),
    ) {
        let before = snapshot_of(before);
        let after = snapshot_of(after);

        let Some(mut counted) = edited_folder(&before, pick) else {
            return Ok(());
        };
        counted.fs.ops = 0;
        let _ = mirror(&mut counted.fs, &after, &counted.previous, Some(&counted.base), &flags)
            .expect("counting run");
        let Some(fail_at) = pick_op(counted.fs.ops, seed) else {
            return Ok(());
        };

        let Edited { mut fs, previous, base, path: edited } =
            edited_folder(&before, pick).expect("same setup");
        fs.fail_at = Some(fail_at);
        fs.ops = 0;
        let _ = mirror(&mut fs, &after, &previous, Some(&base), &flags);
        prop_assert!(fs.ops >= fail_at, "fault {} never fired", fail_at);
        fs.fail_at = None;
        let last = mirror(&mut fs, &after, &previous, Some(&base), &[]).expect("clean rerun");

        let text = fs.inner.read_text(&edited).expect("edited file still present");
        prop_assert_eq!(text, "reader edit\n");
        prop_assert!(
            last.held_back.contains(&edited),
            "edited {} not held back",
            edited
        );
    }
}

#[test]
fn first_write_failure_aborts_and_leaves_the_folder_untouched() {
    let snap = snapshot_of(vec![note("n1", "Alpha", "![](vault:u1/n1/a.png)\n")]);
    let mut fs = fresh();
    fs.fail_at = Some(1);

    let result = mirror(&mut fs, &snap, &[], None, &[]);

    assert_eq!(result.err(), Some(FsError::Io("injected".into())));
    assert!(fs.inner.to_record().is_empty());
}

#[test]
fn failed_remove_is_retried_by_the_rerun() {
    let before = snapshot_of(vec![
        note("n1", "Alpha", "plain body\n"),
        note("n2", "Beta", "other text\n"),
    ]);
    let after = snapshot_of(vec![note("n1", "Alpha", "plain body\n")]);

    let mut reference = fresh();
    let first = mirror(&mut reference, &before, &[], None, &[]).expect("clean run");
    let previous = departed(&first);
    let _ = mirror(&mut reference, &after, &previous, None, &[]).expect("clean run");
    let expected = reference.inner.to_record();
    let gone: Vec<String> = previous
        .iter()
        .filter(|path| !expected.contains_key(path.as_str()))
        .cloned()
        .collect();
    // The run fails its last op, which removes the last departed path; one path keeps that unambiguous.
    assert_eq!(gone.len(), 1);

    // Removes come after every write, so the last op of the run is a remove.
    let mut counted = fresh();
    let _ = mirror(&mut counted, &before, &[], None, &[]).expect("clean run");
    counted.ops = 0;
    let _ = mirror(&mut counted, &after, &previous, None, &[]).expect("clean run");
    let total = counted.ops;

    let mut fs = fresh();
    let _ = mirror(&mut fs, &before, &[], None, &[]).expect("clean run");
    fs.ops = 0;
    fs.fail_at = Some(total);
    let _ = mirror(&mut fs, &after, &previous, None, &[]).expect("remove errors are ignored");
    assert!(fs.inner.stat(&gone[0]).is_some());

    fs.fail_at = None;
    let _ = mirror(&mut fs, &after, &previous, None, &[]).expect("clean rerun");
    assert_eq!(fs.inner.to_record(), expected);
}

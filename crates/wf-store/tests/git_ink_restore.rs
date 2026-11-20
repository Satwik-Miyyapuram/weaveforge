//! Ink pages in a note's `<name>.ink/` folder survive a push and a clone: a fresh folder
//! that pulls the remote gets the same chunk bytes back, and no strokes folder is ignored.
#![allow(clippy::unwrap_used, clippy::panic)]

#[cfg(test)]
mod common;

use common::TempDir;

use std::fs;
use std::path::Path;

use git2::Repository;
use wf_store::git::policy::is_under_ignored_folder;
use wf_store::git::remote::{RemoteConfig, pull, push};
use wf_store::git::repo::{Author, FolderRepo};

const ME: Author<'static> = Author {
    name: "Tester",
    email: "tester@example.test",
};

const NOTE: &str = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
const PAGE_A: &str = "01J0000000000000000000000A";
const PAGE_B: &str = "01J0000000000000000000000B";

fn bare() -> (TempDir, String) {
    let dir = TempDir::new();
    let _ = Repository::init_bare(dir.path()).unwrap();
    let url = dir.path().to_string_lossy().into_owned();
    (dir, url)
}

fn cfg(url: &str) -> RemoteConfig {
    RemoteConfig {
        url: url.to_owned(),
        token: None,
        username: None,
    }
}

fn write_bytes(root: &Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

/// Chunk bytes as the store writes them: binary, not text, so a text-only
/// round trip cannot hide a corrupted file.
fn page_a() -> Vec<u8> {
    vec![0, 159, 146, 150, 255, 1, 0, 0, 42]
}

fn page_b() -> Vec<u8> {
    (0..4096u32).map(|i| (i % 251) as u8).collect()
}

fn sidecar(rel_id: &str) -> String {
    format!("p/notes/{NOTE}.ink/{rel_id}.inkb")
}

#[test]
fn ink_sidecar_is_not_ignored_by_sync_policy() {
    assert!(!is_under_ignored_folder(&sidecar(PAGE_A)));
    assert!(!is_under_ignored_folder(&format!("p/notes/{NOTE}.ink")));
    // The legacy folder the migration copies from is kept and synced as it was.
    assert!(!is_under_ignored_folder(".ink"));
}

#[test]
fn ink_sidecar_survives_push_and_clone_byte_for_byte() {
    let (_remote_dir, url) = bare();

    // The machine that drew the ink: two pages in the note's strokes folder.
    let a_dir = TempDir::new();
    let writer = FolderRepo::new(a_dir.path());
    writer.init().unwrap();
    Repository::open(writer.root())
        .unwrap()
        .set_head("refs/heads/main")
        .unwrap();
    write_bytes(writer.root(), &sidecar(PAGE_A), &page_a());
    write_bytes(writer.root(), &sidecar(PAGE_B), &page_b());
    let _ = writer.commit_all("ink", ME).unwrap();
    let _ = push(&writer, &cfg(&url)).unwrap();

    // A clone restores the folder from the remote, into an empty folder.
    let b_dir = TempDir::new();
    let restored = FolderRepo::new(b_dir.path());
    let _ = pull(&restored, &cfg(&url)).unwrap();

    assert_eq!(
        fs::read(restored.root().join(sidecar(PAGE_A))).unwrap(),
        page_a()
    );
    assert_eq!(
        fs::read(restored.root().join(sidecar(PAGE_B))).unwrap(),
        page_b()
    );

    // Nothing in the strokes folder is left untracked on the clone: the restored
    // folder is clean, so the next sync has nothing to push or stage.
    assert!(restored.status().unwrap().is_empty());
}

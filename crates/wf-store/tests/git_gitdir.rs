//! Integration tests for a folder repo whose git data lives outside the folder, syncing a branch other than `main`.
#![allow(clippy::unwrap_used, clippy::panic)]

#[cfg(test)]
mod common;

use common::TempDir;

use std::fs;
use std::path::Path;

use git2::{Oid, Repository};
use wf_store::git::remote::{
    PullOutcome, PushOutcome, RemoteConfig, RemoteStatus, pull, push, remote_status,
};
use wf_store::git::repo::{Author, DEFAULT_BRANCH, FolderRepo};

const ME: Author<'static> = Author {
    name: "Tester",
    email: "tester@example.test",
};

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

fn write(root: &Path, rel: &str, text: &str) {
    fs::write(root.join(rel), text).unwrap();
}

/// A folder whose git data sits in its own directory, syncing `branch`.
fn split(branch: &str) -> (TempDir, TempDir, FolderRepo) {
    let root = TempDir::new();
    let git_dir = TempDir::new();
    let repo = FolderRepo::new(root.path())
        .with_git_dir(git_dir.path())
        .with_branch(branch);
    (root, git_dir, repo)
}

fn head_of(git_dir: &Path) -> Option<Oid> {
    let git = Repository::open(git_dir).ok()?;
    git.head().ok()?.target()
}

fn remote_branch(url: &str, branch: &str) -> Option<Oid> {
    let bare = Repository::open_bare(url).ok()?;
    bare.find_reference(&format!("refs/heads/{branch}"))
        .ok()?
        .target()
}

/// A bare remote whose `master` holds one commit pushed from another separate git dir.
fn seeded() -> (TempDir, String, Oid) {
    let (dir, url) = bare();
    let (_seed_root, _seed_git, seed) = split("master");
    write(seed.root(), "seed.md", "from the other machine");
    assert_eq!(push(&seed, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let tip = remote_branch(&url, "master").unwrap();
    (dir, url, tip)
}

#[test]
fn git_dir_keeps_metadata_out_of_the_folder() {
    let root = TempDir::new();
    let git_dir = TempDir::new();
    let repo = FolderRepo::new(root.path()).with_git_dir(git_dir.path());
    repo.init().unwrap();
    write(root.path(), "a.md", "one");
    assert!(repo.commit_all("first", ME).unwrap().is_some());
    assert!(!root.path().join(".git").exists());
    assert!(git_dir.path().join("HEAD").exists());
    assert!(repo.is_repo());
    assert!(!FolderRepo::new(root.path()).is_repo());
}

#[test]
fn branch_defaults_to_main_and_can_be_replaced() {
    let root = TempDir::new();
    assert_eq!(DEFAULT_BRANCH, "main");
    assert_eq!(FolderRepo::new(root.path()).branch(), "main");
    assert_eq!(
        FolderRepo::new(root.path()).with_branch("master").branch(),
        "master"
    );
}

#[test]
fn push_master_from_a_separate_git_dir() {
    let (_bare, url) = bare();
    let (root, git_dir, repo) = split("master");
    write(root.path(), "a.md", "one");
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let local = head_of(git_dir.path());
    assert!(local.is_some());
    assert_eq!(remote_branch(&url, "master"), local);
    assert_eq!(remote_branch(&url, "main"), None);
    assert!(!root.path().join(".git").exists());
}

#[test]
fn pull_master_into_a_fresh_separate_git_dir() {
    let (_bare, url, tip) = seeded();
    let (root, git_dir, repo) = split("master");
    let outcome = pull(&repo, &cfg(&url)).unwrap();
    assert_eq!(
        outcome,
        PullOutcome::FastForward {
            oid: tip.to_string()
        }
    );
    assert_eq!(
        fs::read_to_string(root.path().join("seed.md")).unwrap(),
        "from the other machine"
    );
    assert!(!root.path().join(".git").exists());
    assert_eq!(head_of(git_dir.path()), Some(tip));
}

#[test]
fn status_on_master_is_level_after_pull() {
    let (_bare, url, tip) = seeded();
    let (_root, _git_dir, repo) = split("master");
    let _ = pull(&repo, &cfg(&url)).unwrap();
    assert_eq!(
        remote_status(&repo, &cfg(&url)).unwrap(),
        RemoteStatus {
            url: Some(url.clone()),
            branch: "master".to_owned(),
            ahead: 0,
            behind: 0,
        }
    );
    assert_eq!(remote_branch(&url, "master"), Some(tip));
}

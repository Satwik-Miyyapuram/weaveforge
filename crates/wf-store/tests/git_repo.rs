//! Integration tests for `wf_store::git::repo`: init, status, commit, log and read-back on a real folder.
#![allow(clippy::unwrap_used, clippy::panic)]

#[cfg(test)]
mod common;

use common::TempDir;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use git2::{ObjectType, Repository, TreeWalkMode, TreeWalkResult};
use wf_store::git::policy::{FileState, RepoState};
use wf_store::git::repo::{
    Author, Commit, CommitOutcome, FileChange, FolderRepo, RepoError, commit_vault,
    iso_with_offset, probe,
};

fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, bytes).unwrap();
}

fn me() -> Author<'static> {
    Author {
        name: "Tester",
        email: "t@example.com",
    }
}

fn change(path: &str, state: FileState) -> FileChange {
    FileChange {
        path: path.to_owned(),
        state,
    }
}

fn paths(repo: &FolderRepo) -> Vec<String> {
    repo.status().unwrap().into_iter().map(|c| c.path).collect()
}

fn exclude_text(root: &Path) -> String {
    fs::read_to_string(root.join(".git").join("info").join("exclude")).unwrap()
}

fn lock_path(root: &Path) -> PathBuf {
    root.join(".git").join("index.lock")
}

/// Every blob path under the tree of `rev`, `/`-separated.
fn tree_files(root: &Path, rev: &str) -> Vec<String> {
    let repo = Repository::open(root).unwrap();
    let tree = repo.revparse_single(rev).unwrap().peel_to_tree().unwrap();
    let mut names = Vec::new();
    tree.walk(TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(ObjectType::Blob) {
            names.push(format!("{dir}{}", entry.name().unwrap_or_default()));
        }
        TreeWalkResult::Ok
    })
    .unwrap();
    names
}

fn messages(log: &[Commit]) -> Vec<&str> {
    log.iter().map(|c| c.message.as_str()).collect()
}

#[test]
fn probe_none_for_plain_folder() {
    let dir = TempDir::new();
    write(dir.path(), "a.md", b"x");
    assert_eq!(probe(dir.path()), RepoState::None);
}

#[test]
fn probe_own_after_init() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    assert_eq!(probe(dir.path()), RepoState::Own);
    assert!(repo.is_repo());
}

#[test]
fn probe_enclosing_for_subfolder() {
    let dir = TempDir::new();
    FolderRepo::new(dir.path()).init().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir_all(&sub).unwrap();
    let RepoState::Enclosing { root } = probe(&sub) else {
        panic!("expected Enclosing for {}", sub.display());
    };
    assert_eq!(
        fs::canonicalize(&root).unwrap(),
        fs::canonicalize(dir.path()).unwrap()
    );
    assert!(!FolderRepo::new(&sub).is_repo());
}

#[test]
fn init_twice_keeps_history() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"one");
    let _ = repo.commit_all("first", me()).unwrap();
    repo.init().unwrap();
    assert_eq!(repo.log(None, None).len(), 1);
}

#[test]
fn status_reports_added_modified_deleted() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"a");
    write(dir.path(), "b.md", b"b");
    let _ = repo.commit_all("two", me()).unwrap();
    write(dir.path(), "a.md", b"a changed");
    fs::remove_file(dir.path().join("b.md")).unwrap();
    write(dir.path(), "c.md", b"c");
    assert_eq!(
        repo.status().unwrap(),
        vec![
            change("a.md", FileState::Modified),
            change("b.md", FileState::Deleted),
            change("c.md", FileState::Added),
        ]
    );
}

#[test]
fn status_skips_root_meta_dir_but_not_nested() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), ".weaveforge/db.sqlite", b"db");
    write(dir.path(), "notes/.weaveforge/x.md", b"x");
    assert_eq!(paths(&repo), ["notes/.weaveforge/x.md"]);
}

#[test]
fn status_skips_ignored_dirs_files_and_extensions() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "node_modules/x.js", b"x");
    write(dir.path(), "deep/dist/y.js", b"y");
    write(dir.path(), "Desktop.ini", b"d");
    write(dir.path(), "paper.aux", b"a");
    write(dir.path(), "keep.md", b"k");
    assert_eq!(paths(&repo), ["keep.md"]);
}

#[test]
fn status_skips_over_size_new_file() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path()).with_max_file_bytes(10);
    repo.init().unwrap();
    write(dir.path(), "big.bin", &[0; 11]);
    write(dir.path(), "small.txt", &[0; 10]);
    assert_eq!(paths(&repo), ["small.txt"]);
}

#[test]
fn status_reports_deletion_of_over_size_tracked_file() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path()).with_max_file_bytes(10);
    repo.init().unwrap();
    write(dir.path(), "f.txt", &[b'a'; 5]);
    let _ = repo.commit_all("five", me()).unwrap();
    write(dir.path(), "f.txt", &[b'a'; 50]);
    assert_eq!(repo.status().unwrap(), Vec::new());
    fs::remove_file(dir.path().join("f.txt")).unwrap();
    assert_eq!(
        repo.status().unwrap(),
        vec![change("f.txt", FileState::Deleted)]
    );
}

#[test]
fn commit_all_on_clean_tree_returns_none() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"a");
    let _ = repo.commit_all("first", me()).unwrap();
    assert_eq!(repo.commit_all("again", me()).unwrap(), None);

    let fresh = TempDir::new();
    let empty = FolderRepo::new(fresh.path());
    empty.init().unwrap();
    assert_eq!(empty.commit_all("nothing", me()).unwrap(), None);
}

#[test]
fn commit_all_returns_head_commit() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"a");
    let c = repo.commit_all("first", me()).unwrap().unwrap();
    assert_eq!(c.oid.len(), 40);
    assert_eq!(c.message, "first");
    assert_eq!(c.author, "Tester");
    let raw = Repository::open(dir.path()).unwrap();
    let head = raw.head().unwrap();
    assert_eq!(head.target().unwrap().to_string(), c.oid);
    assert_eq!(
        head.peel_to_commit().unwrap().author().email().unwrap(),
        "t@example.com"
    );
}

#[test]
fn commit_all_excludes_policy_refused_files() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path()).with_max_file_bytes(10);
    repo.init().unwrap();
    write(dir.path(), "keep.md", b"k");
    write(dir.path(), "node_modules/x.js", b"x");
    write(dir.path(), ".weaveforge/db", b"db");
    write(dir.path(), "big.bin", &[0; 11]);
    let _ = repo.commit_all("mixed", me()).unwrap();
    assert_eq!(tree_files(dir.path(), "HEAD"), ["keep.md"]);
}

#[test]
fn commit_all_untracks_root_meta_dir_added_earlier() {
    let dir = TempDir::new();
    let raw = Repository::init(dir.path()).unwrap();
    write(dir.path(), ".weaveforge/db", b"db");
    write(dir.path(), "a.md", b"a");
    let mut index = raw.index().unwrap();
    index.add_path(Path::new(".weaveforge/db")).unwrap();
    index.add_path(Path::new("a.md")).unwrap();
    index.write().unwrap();
    let tree = raw.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = git2::Signature::now("Tester", "t@example.com").unwrap();
    let _oid = raw
        .commit(Some("HEAD"), &sig, &sig, "raw", &tree, &[])
        .unwrap();

    let c = FolderRepo::new(dir.path()).commit_all("x", me()).unwrap();
    assert!(c.is_some());
    assert_eq!(tree_files(dir.path(), "HEAD"), ["a.md"]);
    assert!(dir.path().join(".weaveforge").join("db").exists());
}

#[test]
fn commit_all_keeps_old_version_of_grown_tracked_file() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path()).with_max_file_bytes(10);
    repo.init().unwrap();
    write(dir.path(), "f.txt", b"12345");
    let _ = repo.commit_all("five", me()).unwrap();
    write(dir.path(), "f.txt", &[b'z'; 50]);
    write(dir.path(), "g.md", b"g");
    let c = repo.commit_all("grow", me()).unwrap().unwrap();
    assert_eq!(repo.read_at(&c.oid, "f.txt"), Some(b"12345".to_vec()));
    assert!(repo.read_at(&c.oid, "g.md").is_some());
}

#[test]
fn commit_all_records_deletion() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"a");
    write(dir.path(), "b.md", b"b");
    let _ = repo.commit_all("two", me()).unwrap();
    fs::remove_file(dir.path().join("b.md")).unwrap();
    let _ = repo.commit_all("drop b", me()).unwrap();
    assert_eq!(tree_files(dir.path(), "HEAD"), ["a.md"]);
}

#[test]
fn write_excludes_is_idempotent() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"a");
    let _ = repo.commit_all("one", me()).unwrap();
    write(dir.path(), "b.md", b"b");
    let _ = repo.commit_all("two", me()).unwrap();
    let text = exclude_text(dir.path());
    for line in ["/.weaveforge/", "node_modules/", "desktop.ini", "*.aux"] {
        assert_eq!(text.lines().filter(|l| *l == line).count(), 1, "{line}");
    }
}

#[test]
fn exclude_keeps_existing_user_lines() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    fs::write(
        dir.path().join(".git").join("info").join("exclude"),
        "mine/",
    )
    .unwrap();
    write(dir.path(), "a.md", b"a");
    let _ = repo.commit_all("one", me()).unwrap();
    let text = exclude_text(dir.path());
    assert!(text.starts_with("mine/\n"));
    assert!(text.contains("/.weaveforge/"));
}

#[test]
fn stale_lock_is_named_and_kept() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"a");
    let _ = repo.commit_all("one", me()).unwrap();
    let lock = lock_path(dir.path());
    fs::write(&lock, b"").unwrap();
    fs::File::options()
        .write(true)
        .open(&lock)
        .unwrap()
        .set_modified(SystemTime::now() - Duration::from_secs(600))
        .unwrap();
    write(dir.path(), "b.md", b"b");
    let err = repo.commit_all("two", me()).unwrap_err();
    let RepoError::StaleLock(msg) = err else {
        panic!("expected StaleLock, got {err}");
    };
    assert!(msg.contains("index.lock"), "{msg}");
    assert!(msg.contains("10 min ago"), "{msg}");
    assert!(msg.contains("delete it"), "{msg}");
    assert!(lock.exists());
}

#[test]
fn fresh_lock_returns_plain_error() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"a");
    let _ = repo.commit_all("one", me()).unwrap();
    let lock = lock_path(dir.path());
    fs::write(&lock, b"").unwrap();
    write(dir.path(), "b.md", b"b");
    let err = repo.commit_all("two", me()).unwrap_err();
    assert!(matches!(err, RepoError::Git(_)), "{err}");
    assert!(lock.exists());
}

#[test]
fn log_is_newest_first_and_limited() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    for msg in ["one", "two", "three"] {
        write(dir.path(), &format!("{msg}.md"), b"x");
        let _ = repo.commit_all(msg, me()).unwrap();
        // Git's time sort needs distinct seconds to order commits.
        std::thread::sleep(Duration::from_millis(1100));
    }
    assert_eq!(messages(&repo.log(None, None)), ["three", "two", "one"]);
    assert_eq!(repo.log(Some(2), None).len(), 2);
    assert_eq!(repo.log(Some(0), None).len(), 3);
}

#[test]
fn log_filters_by_path() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "a.md", b"1");
    let c1 = repo.commit_all("c1", me()).unwrap().unwrap();
    std::thread::sleep(Duration::from_millis(1100));
    write(dir.path(), "b.md", b"b");
    let _ = repo.commit_all("c2", me()).unwrap();
    std::thread::sleep(Duration::from_millis(1100));
    write(dir.path(), "a.md", b"2");
    let c3 = repo.commit_all("c3", me()).unwrap().unwrap();
    std::thread::sleep(Duration::from_millis(1100));
    assert_eq!(
        messages(&repo.log(None, Some("a.md"))),
        [c3.message.as_str(), c1.message.as_str()]
    );
    write(dir.path(), "n/x.md", b"n");
    let _ = repo.commit_all("nested", me()).unwrap();
    assert_eq!(messages(&repo.log(None, Some("n/x.md"))), ["nested"]);
}

#[test]
fn log_empty_for_unborn_or_no_repo() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    assert!(repo.log(None, None).is_empty());
    let plain = TempDir::new();
    write(plain.path(), "a.md", b"a");
    assert!(FolderRepo::new(plain.path()).log(None, None).is_empty());
}

#[test]
fn read_at_returns_bytes_or_none() {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    repo.init().unwrap();
    write(dir.path(), "n/x.bin", &[0, 159, 255]);
    let c = repo.commit_all("bin", me()).unwrap().unwrap();
    assert_eq!(repo.read_at(&c.oid, "n/x.bin"), Some(vec![0, 159, 255]));
    assert_eq!(repo.read_at(&c.oid, "wrong.md"), None);
    assert_eq!(repo.read_at("zzz", "n/x.bin"), None);
    assert_eq!(repo.read_at(&"0".repeat(40), "n/x.bin"), None);
}

#[test]
fn iso_with_offset_matches_git() {
    assert_eq!(iso_with_offset(0, 0), "1970-01-01T00:00:00+00:00");
    assert_eq!(
        iso_with_offset(1_793_196_309, 60),
        "2026-10-28T15:05:09+01:00"
    );
    assert_eq!(iso_with_offset(951_782_400, 0), "2000-02-29T00:00:00+00:00");
    assert_eq!(iso_with_offset(-1, 0), "1969-12-31T23:59:59+00:00");
    assert_eq!(iso_with_offset(0, -330), "1969-12-31T18:30:00-05:30");
}

#[test]
fn commit_vault_paths() {
    let dir = TempDir::new();
    let off = commit_vault(dir.path(), false);
    assert_eq!(
        off,
        CommitOutcome {
            commit: None,
            reason: Some("Folder history is switched off.".to_owned()),
        }
    );
    assert!(!dir.path().join(".git").exists());

    write(dir.path(), "a.md", b"a");
    let first = commit_vault(dir.path(), true);
    assert!(first.reason.is_none());
    assert_eq!(first.commit.unwrap().message, "1 added");
    assert!(dir.path().join(".git").exists());

    assert_eq!(
        commit_vault(dir.path(), true),
        CommitOutcome {
            commit: None,
            reason: None,
        }
    );

    let sub = dir.path().join("sub");
    fs::create_dir_all(&sub).unwrap();
    let inside = commit_vault(&sub, true);
    assert!(inside.commit.is_none());
    assert!(
        inside
            .reason
            .is_some_and(|r| r.contains("inside the repository at"))
    );
}

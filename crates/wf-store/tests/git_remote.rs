//! Integration tests for `wf_store::git::remote`: sync a folder repo with a bare remote.
#![allow(clippy::unwrap_used, clippy::panic)]

#[cfg(test)]
mod common;

use common::TempDir;

use std::fs;
use std::path::Path;

use git2::{Oid, Repository};
use wf_store::git::remote::{
    PULL_FIRST, PullOutcome, PushOutcome, RemoteConfig, RemoteStatus, describe_pull, describe_push,
    pull, push, redact_secret, redact_secret_for, rejection_reason, remote_status, token_may_go_to,
};
use wf_store::git::repo::{Author, FolderRepo};

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

fn folder() -> (TempDir, FolderRepo) {
    let dir = TempDir::new();
    let repo = FolderRepo::new(dir.path());
    (dir, repo)
}

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, text).unwrap();
}

fn cfg(url: &str) -> RemoteConfig {
    RemoteConfig {
        url: url.to_owned(),
        token: None,
        username: None,
    }
}

fn commit(repo: &FolderRepo, message: &str) {
    if !repo.is_repo() {
        repo.init().unwrap();
        Repository::open(repo.root())
            .unwrap()
            .set_head("refs/heads/main")
            .unwrap();
    }
    let _ = repo.commit_all(message, ME).unwrap();
}

/// Writes `rel` and commits everything with `message`.
fn save(repo: &FolderRepo, rel: &str, text: &str, message: &str) {
    write(repo.root(), rel, text);
    commit(repo, message);
}

/// A second folder that pulls from `url`: "the other machine".
fn clone_into(url: &str) -> (TempDir, FolderRepo) {
    let (dir, repo) = folder();
    let _ = pull(&repo, &cfg(url)).unwrap();
    (dir, repo)
}

fn head_of(repo: &FolderRepo) -> Option<Oid> {
    let git = Repository::open(repo.root()).ok()?;
    git.head().ok()?.target()
}

fn remote_main(url: &str) -> Option<Oid> {
    let bare = Repository::open_bare(url).ok()?;
    bare.find_reference("refs/heads/main").ok()?.target()
}

fn status_of(url: Option<&str>, ahead: usize, behind: usize) -> RemoteStatus {
    RemoteStatus {
        url: url.map(str::to_owned),
        branch: "main".to_owned(),
        ahead,
        behind,
    }
}

#[test]
fn status_without_repo_is_empty_and_creates_nothing() {
    let (dir, repo) = folder();
    let (_bare, url) = bare();
    let status = remote_status(&repo, &cfg(&url)).unwrap();
    assert_eq!(status, status_of(None, 0, 0));
    assert!(!dir.path().join(".git").exists());
}

#[test]
fn first_push_sends_commits_and_status_is_level() {
    let (_bare, url) = bare();
    let (_dir, repo) = folder();
    write(repo.root(), "a.md", "one");
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    assert_eq!(remote_main(&url), head_of(&repo));
    assert_eq!(
        remote_status(&repo, &cfg(&url)).unwrap(),
        status_of(Some(&url), 0, 0)
    );
}

#[test]
fn push_twice_is_up_to_date() {
    let (_bare, url) = bare();
    let (_dir, repo) = folder();
    save(&repo, "a.md", "one", "first");
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::UpToDate);
}

#[test]
fn push_unborn_is_up_to_date() {
    let (_bare, url) = bare();
    let (_dir, repo) = folder();
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::UpToDate);
    assert_eq!(remote_main(&url), None);
}

#[test]
fn push_commits_pending_changes_first() {
    let (_bare, url) = bare();
    let (_dir, repo) = folder();
    save(&repo, "a.md", "one", "first");
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    write(repo.root(), "b.md", "two");
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let bare = Repository::open_bare(&url).unwrap();
    let tip = bare
        .find_reference("refs/heads/main")
        .unwrap()
        .peel_to_commit()
        .unwrap();
    assert_eq!(tip.author().name(), Ok("WeaveForge"));
    assert!(tip.tree().unwrap().get_name("b.md").is_some());
}

#[test]
fn status_counts_ahead_and_behind() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "a.md", "one", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b_dir, b) = clone_into(&url);
    save(&a, "a.md", "two", "a2");
    save(&a, "a3.md", "three", "a3");
    save(&b, "b.md", "b", "b1");
    assert_eq!(push(&b, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    assert_eq!(
        remote_status(&a, &cfg(&url)).unwrap(),
        status_of(Some(&url), 2, 1)
    );
}

#[test]
fn push_rejected_when_remote_is_ahead() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "a.md", "one", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b_dir, b) = clone_into(&url);
    save(&b, "b.md", "b", "b1");
    assert_eq!(push(&b, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    save(&a, "a.md", "two", "a2");
    assert_eq!(
        push(&a, &cfg(&url)).unwrap(),
        PushOutcome::Rejected {
            reason: PULL_FIRST.to_owned()
        }
    );
    assert_eq!(remote_main(&url), head_of(&b));
}

#[test]
fn pull_fast_forwards() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "a.md", "one", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b_dir, b) = folder();
    assert_eq!(
        pull(&b, &cfg(&url)).unwrap(),
        PullOutcome::FastForward {
            oid: head_of(&a).unwrap().to_string()
        }
    );
    assert_eq!(fs::read_to_string(b.root().join("a.md")).unwrap(), "one");
}

#[test]
fn pull_up_to_date() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "a.md", "one", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b_dir, b) = clone_into(&url);
    assert_eq!(pull(&b, &cfg(&url)).unwrap(), PullOutcome::UpToDate);
}

#[test]
fn pull_on_remote_without_main_is_up_to_date_then_push_works() {
    let (_bare, url) = bare();
    let (_dir, repo) = folder();
    save(&repo, "a.md", "one", "a1");
    assert_eq!(pull(&repo, &cfg(&url)).unwrap(), PullOutcome::UpToDate);
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    assert_eq!(remote_main(&url), head_of(&repo));
}

#[test]
fn pull_merges_divergent_histories() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "base.md", "base", "base");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b_dir, b) = clone_into(&url);
    save(&a, "a.md", "from a", "a change");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    save(&b, "b.md", "from b", "b change");
    let PullOutcome::Merged { oid } = pull(&b, &cfg(&url)).unwrap() else {
        panic!("expected a merge");
    };
    let git = Repository::open(b.root()).unwrap();
    let head = git.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id().to_string(), oid);
    assert_eq!(head.parent_count(), 2);
    assert_eq!(head.summary(), Ok(Some("Merge main from the remote")));
    assert_eq!(fs::read_to_string(b.root().join("a.md")).unwrap(), "from a");
    assert_eq!(fs::read_to_string(b.root().join("b.md")).unwrap(), "from b");
}

#[test]
fn pull_conflict_leaves_files_untouched() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "a.md", "one\n", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b_dir, b) = clone_into(&url);
    save(&a, "a.md", "from a\n", "a2");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    save(&b, "a.md", "from b\n", "b2");
    let before = head_of(&b);
    assert_eq!(
        pull(&b, &cfg(&url)).unwrap(),
        PullOutcome::Conflict {
            files: vec!["a.md".to_owned()]
        }
    );
    assert_eq!(
        fs::read_to_string(b.root().join("a.md")).unwrap(),
        "from b\n"
    );
    assert_eq!(head_of(&b), before);
    let git = Repository::open(b.root()).unwrap();
    assert!(!git.index().unwrap().has_conflicts());
}

#[test]
fn pull_refuses_to_overwrite_ignored_or_untracked_file() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "notes/x.md", "from a", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    // A cap of 4 bytes makes B's copy policy-refused, so it is never committed.
    let dir = TempDir::new();
    let b = FolderRepo::new(dir.path()).with_max_file_bytes(4);
    write(b.root(), "notes/x.md", "a file too large for the cap");
    assert_eq!(
        pull(&b, &cfg(&url)).unwrap(),
        PullOutcome::Conflict {
            files: vec!["notes/x.md".to_owned()]
        }
    );
    assert_eq!(
        fs::read_to_string(b.root().join("notes/x.md")).unwrap(),
        "a file too large for the cap"
    );
}

#[test]
fn pull_merges_unrelated_histories() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "a.md", "from a", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b_dir, b) = folder();
    save(&b, "b.md", "from b", "b1");
    assert!(matches!(
        pull(&b, &cfg(&url)).unwrap(),
        PullOutcome::Merged { .. }
    ));
    assert_eq!(fs::read_to_string(b.root().join("a.md")).unwrap(), "from a");
    assert_eq!(fs::read_to_string(b.root().join("b.md")).unwrap(), "from b");
}

#[test]
fn connect_sets_url_and_leaves_origin_alone() {
    let (_bare1, url1) = bare();
    let (_bare2, url2) = bare();
    let (_dir, repo) = folder();
    save(&repo, "a.md", "one", "a1");
    let git = Repository::open(repo.root()).unwrap();
    let _ = git.remote("origin", "https://example.com/o.git").unwrap();
    let _ = remote_status(&repo, &cfg(&url1)).unwrap();
    let _ = remote_status(&repo, &cfg(&url2)).unwrap();
    let git = Repository::open(repo.root()).unwrap();
    assert_eq!(
        git.find_remote("weaveforge").unwrap().url(),
        Ok(url2.as_str())
    );
    assert_eq!(
        git.find_remote("origin").unwrap().url(),
        Ok("https://example.com/o.git")
    );
}

#[test]
fn redact_secret_cases() {
    assert_eq!(
        redact_secret("x tok123 y tok123", Some("tok123")),
        "x *** y ***"
    );
    assert_eq!(redact_secret("x tok123", None), "x tok123");
    assert_eq!(redact_secret("x tok123", Some("")), "x tok123");
    // base64 of "x-access-token:tok123", inside surrounding text
    assert_eq!(
        redact_secret("auth eC1hY2Nlc3MtdG9rZW46dG9rMTIz end", Some("tok123")),
        "auth *** end"
    );
    // base64 of "git:tok123"
    assert_eq!(redact_secret("Z2l0OnRvazEyMw==", Some("tok123")), "***");
    // x-access-token:{secret} lengths that are 1, 2 and 0 mod 3
    assert_eq!(redact_secret("eC1hY2Nlc3MtdG9rZW46YQ==", Some("a")), "***");
    assert_eq!(redact_secret("eC1hY2Nlc3MtdG9rZW46YWI=", Some("ab")), "***");
    assert_eq!(
        redact_secret("eC1hY2Nlc3MtdG9rZW46YWJj", Some("abc")),
        "***"
    );
}

#[test]
fn describe_texts() {
    assert_eq!(describe_pull(&PullOutcome::UpToDate), "Already up to date.");
    assert_eq!(
        describe_pull(&PullOutcome::FastForward {
            oid: "abc".to_owned()
        }),
        "Pulled the remote's changes."
    );
    assert_eq!(
        describe_pull(&PullOutcome::Merged {
            oid: "abc".to_owned()
        }),
        "Merged the remote's changes with yours."
    );
    let names = |n: usize| -> Vec<String> {
        ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"]
            .iter()
            .take(n)
            .map(|name| (*name).to_owned())
            .collect()
    };
    assert_eq!(
        describe_pull(&PullOutcome::Conflict { files: names(1) }),
        "Not pulled: 1 file changed on both sides (a.md). Your files were left as they were."
    );
    assert_eq!(
        describe_pull(&PullOutcome::Conflict { files: names(5) }),
        "Not pulled: 5 files changed on both sides (a.md, b.md, c.md, d.md, e.md). Your files were left as they were."
    );
    assert_eq!(
        describe_pull(&PullOutcome::Conflict { files: names(7) }),
        "Not pulled: 7 files changed on both sides (a.md, b.md, c.md, d.md, e.md, …). Your files were left as they were."
    );
    assert_eq!(describe_push(&PushOutcome::Pushed), "Pushed.");
    assert_eq!(describe_push(&PushOutcome::UpToDate), "Nothing to push.");
    assert_eq!(
        describe_push(&PushOutcome::Rejected {
            reason: "x".to_owned()
        }),
        "Not pushed: x"
    );
}

#[test]
fn token_sent_as_basic_auth_is_not_needed_for_local_path() {
    let (_bare, url) = bare();
    let (_dir, repo) = folder();
    save(&repo, "a.md", "one", "a1");
    let config = RemoteConfig {
        url,
        token: Some("t".to_owned()),
        username: None,
    };
    assert_eq!(push(&repo, &config).unwrap(), PushOutcome::Pushed);
}

#[test]
fn syncs_a_folder_on_master() {
    let (_bare, url) = bare();
    let (_dir, repo) = folder();
    repo.init().unwrap();
    Repository::open(repo.root())
        .unwrap()
        .set_head("refs/heads/master")
        .unwrap();
    save(&repo, "a.md", "one", "a1");
    assert_eq!(push(&repo, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    assert_eq!(remote_main(&url), head_of(&repo));
    let git = Repository::open(repo.root()).unwrap();
    assert_eq!(git.head().unwrap().name(), Ok("refs/heads/master"));
}

#[test]
fn pull_fast_forwards_a_master_folder() {
    let (_bare, url) = bare();
    let (_a, a) = folder();
    save(&a, "a.md", "one", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b, b) = clone_into(&url);
    let git = Repository::open(b.root()).unwrap();
    let at = head_of(&b).unwrap();
    let _ = git
        .reference("refs/heads/master", at, false, "test")
        .unwrap();
    git.set_head("refs/heads/master").unwrap();
    git.find_reference("refs/heads/main")
        .unwrap()
        .delete()
        .unwrap();
    save(&a, "b.md", "two", "a2");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let outcome = pull(&b, &cfg(&url)).unwrap();
    assert!(matches!(outcome, PullOutcome::FastForward { .. }));
    assert_eq!(head_of(&b), remote_main(&url));
    assert_eq!(fs::read_to_string(b.root().join("b.md")).unwrap(), "two");
    assert!(git.find_reference("refs/heads/master").is_ok());
    assert!(git.find_reference("refs/heads/main").is_err());
}

#[test]
fn detached_head_push_errors() {
    let (_bare, url) = bare();
    let (_dir, repo) = folder();
    save(&repo, "a.md", "one", "a1");
    let oid = head_of(&repo).unwrap();
    Repository::open(repo.root())
        .unwrap()
        .set_head_detached(oid)
        .unwrap();
    let error = push(&repo, &cfg(&url)).unwrap_err();
    assert!(error.to_string().contains("not on a branch"), "{error}");
}

#[test]
fn token_goes_only_to_the_configured_https_host() {
    let base = "https://github.com/a/b.git";
    assert!(token_may_go_to(base, base));
    assert!(token_may_go_to(base, "https://GitHub.com/other.git"));
    assert!(token_may_go_to(
        "https://user@github.com/a.git",
        "https://github.com/a.git"
    ));
    assert!(!token_may_go_to(base, "https://evil.example/a/b.git"));
    assert!(!token_may_go_to(base, "http://github.com/a/b.git"));
    assert!(!token_may_go_to(base, "https://github.com:8443/a/b.git"));
    assert!(!token_may_go_to(
        "http://github.com/a/b.git",
        "http://github.com/a/b.git"
    ));
    assert!(!token_may_go_to("not a url", "not a url"));
    assert!(!token_may_go_to("", ""));
}

#[test]
fn redact_secret_covers_custom_username() {
    let text = "YWxpY2U6dG9rMTIz eC1hY2Nlc3MtdG9rZW46dG9rMTIz Z2l0OnRvazEyMw== tok123";
    let out = redact_secret_for(text, Some("tok123"), Some("alice"));
    assert_eq!(out, "*** *** *** ***");
}

#[test]
fn pull_does_not_fetch_tags() {
    let (_bare, url) = bare();
    let (_dir, a) = folder();
    save(&a, "a.md", "one", "a1");
    let head = a.root().join(".git");
    let git = Repository::open(a.root()).unwrap();
    let commit = git.head().unwrap().peel(git2::ObjectType::Commit).unwrap();
    let _ = git.tag_lightweight("v1", &commit, false).unwrap();
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let mut direct = git.remote_anonymous(&url).unwrap();
    direct.push(&["refs/tags/v1:refs/tags/v1"], None).unwrap();
    assert!(head.exists());
    let (_b, b) = clone_into(&url);
    let git_b = Repository::open(b.root()).unwrap();
    assert!(git_b.find_reference("refs/tags/v1").is_err());
}

#[cfg(unix)]
#[test]
fn pull_treats_dangling_symlink_as_collision() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "a.md", "one", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let (_b_dir, b) = clone_into(&url);
    let link = b.root().join("b.md");
    std::os::unix::fs::symlink("missing", &link).unwrap();
    save(&a, "b.md", "two", "a2");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let outcome = pull(&b, &cfg(&url)).unwrap();
    match outcome {
        PullOutcome::Conflict { files } => assert!(files.contains(&"b.md".to_owned())),
        other => panic!("expected conflict, got {other:?}"),
    }
    assert!(fs::symlink_metadata(&link).is_ok());
}

#[test]
fn pull_reports_conflict_when_a_capped_local_edit_blocks_checkout() {
    let (_bare, url) = bare();
    let (_a_dir, a) = folder();
    save(&a, "big.bin", "small", "a1");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let b_dir = TempDir::new();
    let b = FolderRepo::new(b_dir.path()).with_max_file_bytes(10);
    let _ = pull(&b, &cfg(&url)).unwrap();
    write(b.root(), "big.bin", "a local edit well above the cap");
    save(&a, "big.bin", "newer", "a2");
    assert_eq!(push(&a, &cfg(&url)).unwrap(), PushOutcome::Pushed);
    let outcome = pull(&b, &cfg(&url)).unwrap();
    match outcome {
        PullOutcome::Conflict { files } => assert!(files.contains(&"big.bin".to_owned())),
        other => panic!("expected conflict, got {other:?}"),
    }
    assert_eq!(
        fs::read_to_string(b.root().join("big.bin")).unwrap(),
        "a local edit well above the cap"
    );
}

#[test]
fn push_reports_hook_refusal_text_not_pull_first() {
    assert_eq!(rejection_reason("non-fast-forward"), PULL_FIRST);
    assert_eq!(rejection_reason("fetch first"), PULL_FIRST);
    assert_eq!(
        rejection_reason("[rejected] main -> main (fetch first)"),
        PULL_FIRST
    );
    assert_eq!(
        rejection_reason("pre-receive hook declined"),
        "The remote refused the push: pre-receive hook declined"
    );
    assert_eq!(
        rejection_reason("protected branch"),
        "The remote refused the push: protected branch"
    );
}

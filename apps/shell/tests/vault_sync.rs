#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for vault sync: the remote URL check, the stored settings, and the sync, commit and log paths.
mod common;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::TempDir;
use keyring_core::CredentialStore;
use serde_json::json;
use weaveforge_shell::git::{CommitReply, GIT_TIMED_OUT, GitQueue};
use weaveforge_shell::prefs::{PrefValue, Prefs};
use weaveforge_shell::secrets::Secrets;
use weaveforge_shell::vault::{NO_ROOT, VaultState};
use weaveforge_shell::vault_sync::{
    NOT_AN_ACTION, SYNC_ACTIONS, SyncOps, SyncPull, SyncPush, SyncSettings, SyncStatus,
    VaultSyncReply, check_git_remote_url, commit, connect_remote, git_reason, log, read_settings,
    sync,
};
use wf_store::git::policy::{GIT_OFF, RepoState};
use wf_store::git::remote::{PullOutcome, PushOutcome, RemoteConfig, RemoteStatus};
use wf_store::git::repo::{FolderRepo, RepoError};

const URL: &str = "https://github.com/me/notes.git";
const SERVICE: &str = "org.weaveforge.test";
const TIMEOUT: Duration = Duration::from_secs(5);

static PROBES: AtomicUsize = AtomicUsize::new(0);
static STATUSES: AtomicUsize = AtomicUsize::new(0);
static CONNECTS: AtomicUsize = AtomicUsize::new(0);
static PULLS: AtomicUsize = AtomicUsize::new(0);
static PUSHES: AtomicUsize = AtomicUsize::new(0);
static LAST_CONFIG: Mutex<Option<RemoteConfig>> = Mutex::new(None);
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Zeroes every call counter and the remembered config.
fn reset_counts() {
    for counter in [&PROBES, &STATUSES, &CONNECTS, &PULLS, &PUSHES] {
        counter.store(0, Ordering::SeqCst);
    }
    *LAST_CONFIG.lock().unwrap() = None;
}

/// Serialises the sync tests, which share the counters above.
async fn begin() -> tokio::sync::MutexGuard<'static, ()> {
    let guard = SERIAL.lock().await;
    reset_counts();
    guard
}

fn begin_blocking() -> tokio::sync::MutexGuard<'static, ()> {
    let guard = SERIAL.blocking_lock();
    reset_counts();
    guard
}

fn remember(config: &RemoteConfig) {
    *LAST_CONFIG.lock().unwrap() = Some(config.clone());
}

fn probe_none(_root: &Path) -> RepoState {
    let _ = PROBES.fetch_add(1, Ordering::SeqCst);
    RepoState::None
}

fn probe_own(_root: &Path) -> RepoState {
    let _ = PROBES.fetch_add(1, Ordering::SeqCst);
    RepoState::Own
}

fn probe_enclosing(_root: &Path) -> RepoState {
    let _ = PROBES.fetch_add(1, Ordering::SeqCst);
    RepoState::Enclosing {
        root: "/up".to_owned(),
    }
}

fn status_ok(_repo: &FolderRepo, config: &RemoteConfig) -> Result<RemoteStatus, RepoError> {
    let _ = STATUSES.fetch_add(1, Ordering::SeqCst);
    remember(config);
    Ok(RemoteStatus {
        url: Some("https://h/r.git".to_owned()),
        branch: "main".to_owned(),
        ahead: 3,
        behind: usize::MAX,
    })
}

fn connect_ok(_repo: &FolderRepo, config: &RemoteConfig) -> Result<RemoteStatus, RepoError> {
    let _ = CONNECTS.fetch_add(1, Ordering::SeqCst);
    remember(config);
    Ok(RemoteStatus {
        url: Some(config.url.clone()),
        branch: "main".to_owned(),
        ahead: 0,
        behind: 0,
    })
}

fn pull_up_to_date(_repo: &FolderRepo, _config: &RemoteConfig) -> Result<PullOutcome, RepoError> {
    let _ = PULLS.fetch_add(1, Ordering::SeqCst);
    Ok(PullOutcome::UpToDate)
}

fn pull_conflict(_repo: &FolderRepo, _config: &RemoteConfig) -> Result<PullOutcome, RepoError> {
    let _ = PULLS.fetch_add(1, Ordering::SeqCst);
    Ok(PullOutcome::Conflict {
        files: vec!["a.md".to_owned()],
    })
}

fn pull_fails(_repo: &FolderRepo, _config: &RemoteConfig) -> Result<PullOutcome, RepoError> {
    let _ = PULLS.fetch_add(1, Ordering::SeqCst);
    Err(RepoError::Git(
        "fatal: auth ghp_tok failed\nhint: x".to_owned(),
    ))
}

fn push_pushed(_repo: &FolderRepo, _config: &RemoteConfig) -> Result<PushOutcome, RepoError> {
    let _ = PUSHES.fetch_add(1, Ordering::SeqCst);
    Ok(PushOutcome::Pushed)
}

/// The fake ops with the given probe; every git call is a counted fixed answer.
fn ops(probe: fn(&Path) -> RepoState) -> SyncOps {
    SyncOps {
        probe,
        status: status_ok,
        connect: connect_ok,
        pull: pull_up_to_date,
        push: push_pushed,
    }
}

fn settings(enabled: bool) -> SyncSettings {
    SyncSettings {
        enabled,
        url: Some(URL.to_owned()),
        token: Some("ghp_tok".to_owned()),
    }
}

fn vault_at(dir: &Path) -> VaultState {
    let vault = VaultState::new();
    let _ = vault.lock().choose(Some(dir)).expect("root");
    vault
}

fn prefs_in(dir: &TempDir) -> Prefs {
    Prefs::new(dir.path().join("prefs.json"))
}

fn secrets() -> Secrets {
    let store: Arc<CredentialStore> = keyring_core::mock::Store::new().expect("mock store");
    Secrets::new(Some(store), SERVICE)
}

fn text(value: &str) -> Option<PrefValue> {
    Some(PrefValue::Text(value.to_owned()))
}

fn base(url: Option<&str>, has_token: bool) -> VaultSyncReply {
    VaultSyncReply {
        url: url.map(str::to_owned),
        has_token,
        status: None,
        pull: None,
        push: None,
    }
}

// check_git_remote_url

#[test]
fn remote_url_refusals_are_exact() {
    let cases: Vec<(Option<&str>, &str)> = vec![
        (None, "Enter the remote's https URL."),
        (Some("  "), "Enter the remote's https URL."),
        (Some(""), "Enter the remote's https URL."),
        (Some("not a url"), "That is not a URL."),
        (Some("http://h/x"), "Only https:// remotes are supported."),
        (Some("git@github.com:me/notes.git"), "That is not a URL."),
        (
            Some("file:///C:/repos/notes"),
            "Only https:// remotes are supported.",
        ),
        (
            Some("ssh://git@github.com/me/notes.git"),
            "Only https:// remotes are supported.",
        ),
        (
            Some("https://u:p@h/x"),
            "Leave the token out of the URL; put it in the token field.",
        ),
        (
            Some("https://u@h/x"),
            "Leave the token out of the URL; put it in the token field.",
        ),
        (
            Some("https://me:ghp_secret@github.com/me/notes.git"),
            "Leave the token out of the URL; put it in the token field.",
        ),
        (
            Some("https://h/"),
            "The URL needs the repository path, e.g. https://github.com/you/notes.git.",
        ),
        (
            Some("https://h"),
            "The URL needs the repository path, e.g. https://github.com/you/notes.git.",
        ),
        (
            Some("https://github.com"),
            "The URL needs the repository path, e.g. https://github.com/you/notes.git.",
        ),
    ];
    for (raw, want) in cases {
        assert_eq!(check_git_remote_url(raw), Err(want.to_owned()), "{raw:?}");
    }
}

#[test]
fn remote_url_accepted_and_normalised() {
    assert_eq!(
        check_git_remote_url(Some(" https://github.com/a/b.git ")),
        Ok("https://github.com/a/b.git".to_owned())
    );
    assert_eq!(
        check_git_remote_url(Some("https://h/x")),
        Ok("https://h/x".to_owned())
    );
}

// git_reason

#[test]
fn git_reason_keeps_git_error_lines() {
    assert_eq!(git_reason("fatal: a\nhint\nerror: b"), "fatal: a error: b");
    assert_eq!(git_reason("plain\nsecond"), "plain");
    assert_eq!(git_reason(""), "Could not commit.");
    assert_eq!(git_reason("\r\nx"), "Could not commit.");
}

// read_settings

#[test]
fn read_settings_reads_all_three_values() {
    let dir = TempDir::new();
    let prefs = prefs_in(&dir);
    let secrets = secrets();
    prefs
        .write("vault-git", Some(PrefValue::Flag(true)))
        .expect("write");
    prefs.write("vault-git-remote", text(URL)).expect("write");
    secrets.write("git-sync-token", "t").expect("write");
    assert_eq!(
        read_settings(&prefs, &secrets),
        SyncSettings {
            enabled: true,
            url: Some(URL.to_owned()),
            token: Some("t".to_owned()),
        }
    );
}

#[test]
fn read_settings_flag_false_disables_and_non_flag_is_off() {
    let dir = TempDir::new();
    let prefs = prefs_in(&dir);
    let secrets = secrets();
    prefs
        .write("vault-git", Some(PrefValue::Flag(false)))
        .expect("write");
    assert!(!read_settings(&prefs, &secrets).enabled);
    prefs.write("vault-git", text("true")).expect("write");
    assert!(!read_settings(&prefs, &secrets).enabled);
}

#[test]
fn read_settings_empty_url_is_absent() {
    let dir = TempDir::new();
    let prefs = prefs_in(&dir);
    let secrets = secrets();
    prefs.write("vault-git-remote", text("")).expect("write");
    assert_eq!(read_settings(&prefs, &secrets).url, None);
}

#[test]
fn read_settings_missing_values_give_default() {
    let dir = TempDir::new();
    assert_eq!(
        read_settings(&prefs_in(&dir), &secrets()),
        SyncSettings::default()
    );
}

// sync

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_root_none_checked_before_action() {
    let _serial = begin().await;
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        None,
        "bogus",
        settings(true),
        TIMEOUT,
    )
    .await;
    assert_eq!(got, Err(NO_ROOT.to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_unknown_action_is_refused_without_probe() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "bogus",
        settings(true),
        TIMEOUT,
    )
    .await;
    assert_eq!(got, Err(NOT_AN_ACTION.to_owned()));
    assert_eq!(NOT_AN_ACTION, "That is not a sync action.");
    assert_eq!(PROBES.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_settings_answers_base_only() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "settings",
        settings(true),
        TIMEOUT,
    )
    .await;
    assert_eq!(got, Ok(base(Some(URL), true)));
    assert_eq!(PROBES.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_settings_empty_token_has_no_token() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let mut stored = settings(false);
    stored.token = Some(String::new());
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "settings",
        stored,
        TIMEOUT,
    )
    .await;
    assert_eq!(got, Ok(base(Some(URL), false)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_history_off_is_refused() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "status",
        settings(false),
        TIMEOUT,
    )
    .await;
    assert_eq!(got, Err(GIT_OFF.to_owned()));
    assert_eq!(GIT_OFF, "Folder history is switched off.");
    assert_eq!(STATUSES.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_enclosing_repository_is_refused() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_enclosing),
        Some(dir.path().to_path_buf()),
        "status",
        settings(true),
        TIMEOUT,
    )
    .await;
    assert_eq!(
        got,
        Err(
            "This folder is inside the repository at /up, so WeaveForge will not commit here."
                .to_owned()
        )
    );
    assert_eq!(STATUSES.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_bad_url_is_refused_before_any_op() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let mut bad = settings(true);
    bad.url = Some("http://h/x".to_owned());
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "pull",
        bad,
        TIMEOUT,
    )
    .await;
    assert_eq!(got, Err("Only https:// remotes are supported.".to_owned()));
    assert_eq!(PULLS.load(Ordering::SeqCst), 0);
    assert_eq!(STATUSES.load(Ordering::SeqCst), 0);
    assert_eq!(CONNECTS.load(Ordering::SeqCst), 0);
    assert_eq!(PUSHES.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_status_without_repo_does_not_touch_git() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_none),
        Some(dir.path().to_path_buf()),
        "status",
        settings(true),
        TIMEOUT,
    )
    .await;
    let mut want = base(Some(URL), true);
    want.status = Some(SyncStatus {
        url: None,
        branch: "main".to_owned(),
        ahead: 0,
        behind: 0,
    });
    assert_eq!(got, Ok(want));
    assert_eq!(PROBES.load(Ordering::SeqCst), 1);
    assert_eq!(STATUSES.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_status_maps_counts_saturating() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "status",
        settings(true),
        TIMEOUT,
    )
    .await;
    let mut want = base(Some(URL), true);
    want.status = Some(SyncStatus {
        url: Some("https://h/r.git".to_owned()),
        branch: "main".to_owned(),
        ahead: 3,
        behind: u32::MAX,
    });
    assert_eq!(got, Ok(want));
    assert_eq!(STATUSES.load(Ordering::SeqCst), 1);
    let seen = LAST_CONFIG.lock().unwrap().clone().expect("config");
    assert_eq!(seen.url, URL);
    assert_eq!(seen.token, Some("ghp_tok".to_owned()));
    assert_eq!(seen.username, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_empty_token_reaches_op_as_none() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let mut stored = settings(true);
    stored.token = Some(String::new());
    let _ = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "status",
        stored,
        TIMEOUT,
    )
    .await;
    let seen = LAST_CONFIG.lock().unwrap().clone().expect("config");
    assert_eq!(seen.token, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_connect_without_repo_calls_connect() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_none),
        Some(dir.path().to_path_buf()),
        "connect",
        settings(true),
        TIMEOUT,
    )
    .await;
    let mut want = base(Some(URL), true);
    want.status = Some(SyncStatus {
        url: Some(URL.to_owned()),
        branch: "main".to_owned(),
        ahead: 0,
        behind: 0,
    });
    assert_eq!(got, Ok(want));
    assert_eq!(CONNECTS.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_pull_up_to_date_is_mapped() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "pull",
        settings(true),
        TIMEOUT,
    )
    .await;
    let mut want = base(Some(URL), true);
    want.pull = Some(SyncPull::UpToDate);
    assert_eq!(got, Ok(want));
    assert_eq!(PULLS.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_pull_conflict_is_mapped() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let mut conflict = ops(probe_own);
    conflict.pull = pull_conflict;
    let got = sync(
        &GitQueue::default(),
        conflict,
        Some(dir.path().to_path_buf()),
        "pull",
        settings(true),
        TIMEOUT,
    )
    .await;
    let mut want = base(Some(URL), true);
    want.pull = Some(SyncPull::Conflict {
        files: vec!["a.md".to_owned()],
    });
    assert_eq!(got, Ok(want));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_push_is_mapped() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let got = sync(
        &GitQueue::default(),
        ops(probe_own),
        Some(dir.path().to_path_buf()),
        "push",
        settings(true),
        TIMEOUT,
    )
    .await;
    let mut want = base(Some(URL), true);
    want.push = Some(SyncPush::Pushed);
    assert_eq!(got, Ok(want));
    assert_eq!(PUSHES.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sync_op_error_has_token_removed() {
    let _serial = begin().await;
    let dir = TempDir::new();
    let mut failing = ops(probe_own);
    failing.pull = pull_fails;
    let got = sync(
        &GitQueue::default(),
        failing,
        Some(dir.path().to_path_buf()),
        "pull",
        settings(true),
        TIMEOUT,
    )
    .await;
    assert_eq!(got, Err("fatal: auth *** failed".to_owned()));
}

#[test]
fn sync_actions_are_the_five_named() {
    assert_eq!(
        SYNC_ACTIONS,
        ["settings", "status", "connect", "pull", "push"]
    );
}

// Mapping from wf-store outcomes

#[test]
fn pull_outcomes_map_to_page_kinds() {
    assert_eq!(SyncPull::from(PullOutcome::UpToDate), SyncPull::UpToDate);
    assert_eq!(
        SyncPull::from(PullOutcome::FastForward {
            oid: "a".to_owned()
        }),
        SyncPull::FastForward {
            oid: "a".to_owned()
        }
    );
    assert_eq!(
        SyncPull::from(PullOutcome::Merged {
            oid: "b".to_owned()
        }),
        SyncPull::Merged {
            oid: "b".to_owned()
        }
    );
    assert_eq!(
        SyncPull::from(PullOutcome::Conflict {
            files: vec!["c.md".to_owned()]
        }),
        SyncPull::Conflict {
            files: vec!["c.md".to_owned()]
        }
    );
}

#[test]
fn push_outcomes_map_to_page_kinds() {
    assert_eq!(SyncPush::from(PushOutcome::Pushed), SyncPush::Pushed);
    assert_eq!(SyncPush::from(PushOutcome::UpToDate), SyncPush::UpToDate);
    assert_eq!(
        SyncPush::from(PushOutcome::Rejected {
            reason: "pull first".to_owned()
        }),
        SyncPush::Rejected {
            reason: "pull first".to_owned()
        }
    );
}

#[test]
fn status_counts_saturate_at_u32_max() {
    let status = SyncStatus::from(RemoteStatus {
        url: None,
        branch: "main".to_owned(),
        ahead: 3,
        behind: usize::MAX,
    });
    assert_eq!(status.ahead, 3);
    assert_eq!(status.behind, u32::MAX);
}

// Serialization

#[test]
fn pull_serialises_with_kebab_kind() {
    let value = serde_json::to_value(SyncPull::FastForward {
        oid: "a".to_owned(),
    })
    .expect("json");
    assert_eq!(value, json!({"kind": "fast-forward", "oid": "a"}));
}

#[test]
fn push_serialises_with_kebab_kind() {
    let value = serde_json::to_value(SyncPush::UpToDate).expect("json");
    assert_eq!(value, json!({"kind": "up-to-date"}));
}

#[test]
fn reply_with_only_status_has_no_pull_or_push_keys() {
    let mut reply = base(None, true);
    reply.status = Some(SyncStatus {
        url: None,
        branch: "main".to_owned(),
        ahead: 0,
        behind: 0,
    });
    let value = serde_json::to_value(reply).expect("json");
    assert_eq!(
        value,
        json!({
            "url": null,
            "hasToken": true,
            "status": {"url": null, "branch": "main", "ahead": 0, "behind": 0}
        })
    );
}

// commit

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn commit_without_root_is_refused() {
    let dir = TempDir::new();
    let got = commit(&GitQueue::default(), &VaultState::new(), &prefs_in(&dir)).await;
    assert_eq!(got, Err(NO_ROOT.to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn commit_with_history_unset_reports_off() {
    let root = TempDir::new();
    let prefs_dir = TempDir::new();
    let got = commit(
        &GitQueue::default(),
        &vault_at(root.path()),
        &prefs_in(&prefs_dir),
    )
    .await;
    assert_eq!(
        got,
        Ok(CommitReply {
            commit: None,
            reason: Some(GIT_OFF.to_owned()),
        })
    );
}

// log

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn log_without_root_is_refused() {
    let got = log(&VaultState::new(), Some(5.0)).await;
    assert_eq!(got, Err(NO_ROOT.to_owned()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn log_of_folder_without_repo_is_empty() {
    let dir = TempDir::new();
    let got = log(&vault_at(dir.path()), None).await;
    assert_eq!(got, Ok(Vec::new()));
}

// connect_remote

#[test]
fn connect_remote_initialises_a_plain_folder() {
    let _serial = begin_blocking();
    let dir = TempDir::new();
    let folder = FolderRepo::new(dir.path());
    let config = RemoteConfig {
        url: "https://127.0.0.1:1/x.git".to_owned(),
        token: None,
        username: None,
    };
    // The remote is unreachable on purpose; only the repository setup is checked.
    let _ = connect_remote(&folder, &config);
    assert!(folder.is_repo());
}

#[test]
fn timeout_message_is_the_git_constant() {
    assert_eq!(GIT_TIMED_OUT, "Git did not finish in time.");
}

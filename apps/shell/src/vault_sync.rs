//! Vault history and sync commands: commit, log, and the remote's status, connect, pull and push.

use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::Url;
use wf_store::git::policy::{CommitAction, RepoState, decide_commit};
use wf_store::git::remote::{
    PullOutcome, PushOutcome, RemoteConfig, RemoteStatus, SYNC_BRANCH, pull, push,
    redact_secret_for, remote_status,
};
use wf_store::git::repo::{FolderRepo, RepoError, probe};

use crate::commands::ShellError;
use crate::git::{
    CommitReply, GIT_TIMED_OUT, GIT_TIMEOUT, GitQueue, GitQueueError, WorkspaceCommit,
    commit_vault_folder, log_limit, vault_log as git_vault_log,
};
use crate::prefs::{PrefValue, Prefs};
use crate::secrets::Secrets;
use crate::vault::{NO_ROOT, VaultState};

/// Said when the page asks for an action that is not one of `SYNC_ACTIONS`.
pub const NOT_AN_ACTION: &str = "That is not a sync action.";
/// The actions the page may ask for.
pub const SYNC_ACTIONS: [&str; 5] = ["settings", "status", "connect", "pull", "push"];
/// Said when no remote URL is stored.
const NO_URL: &str = "Enter the remote's https URL.";
/// Said when the remote URL has no repository path.
const NO_PATH: &str = "The URL needs the repository path, e.g. https://github.com/you/notes.git.";
/// Said when git gave no readable reason.
const FALLBACK_REASON: &str = "Could not commit.";

/// The sync settings as the shell stores them: history switch, remote URL and token.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SyncSettings {
    /// Whether folder history is switched on.
    pub enabled: bool,
    /// The remote URL as stored, if any.
    pub url: Option<String>,
    /// The sign-in token, if any.
    pub token: Option<String>,
}

/// The git operations a sync runs, so tests can swap them.
#[derive(Clone, Copy)]
pub struct SyncOps {
    /// Whether the folder is its own repository, sits in none, or sits in another.
    pub probe: fn(&Path) -> RepoState,
    /// Reads the remote's status without changing the folder.
    pub status: fn(&FolderRepo, &RemoteConfig) -> Result<RemoteStatus, RepoError>,
    /// Creates the repository if needed, then reads the remote's status.
    pub connect: fn(&FolderRepo, &RemoteConfig) -> Result<RemoteStatus, RepoError>,
    /// Brings the remote's changes into the folder.
    pub pull: fn(&FolderRepo, &RemoteConfig) -> Result<PullOutcome, RepoError>,
    /// Sends the folder's commits to the remote.
    pub push: fn(&FolderRepo, &RemoteConfig) -> Result<PushOutcome, RepoError>,
}

/// The real git operations.
pub const GIT_SYNC_OPS: SyncOps = SyncOps {
    probe,
    status: remote_status,
    connect: connect_remote,
    pull,
    push,
};

/// Creates the folder's repository when it has none, then reads the remote's status.
///
/// # Errors
/// When git cannot create the repository or read the remote.
pub fn connect_remote(repo: &FolderRepo, config: &RemoteConfig) -> Result<RemoteStatus, RepoError> {
    if !repo.is_repo() {
        repo.init()?;
    }
    remote_status(repo, config)
}

/// The remote's status as the page sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// The remote URL, or none when the folder has no repository.
    pub url: Option<String>,
    /// The branch synced.
    pub branch: String,
    /// Commits this folder has that the remote lacks.
    pub ahead: u32,
    /// Commits the remote has that this folder lacks.
    pub behind: u32,
}

impl From<RemoteStatus> for SyncStatus {
    fn from(status: RemoteStatus) -> Self {
        Self {
            url: status.url,
            branch: status.branch,
            ahead: u32::try_from(status.ahead).unwrap_or(u32::MAX),
            behind: u32::try_from(status.behind).unwrap_or(u32::MAX),
        }
    }
}

/// What a pull did, as the page sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SyncPull {
    /// Nothing to bring in.
    UpToDate,
    /// The folder moved forward to the remote's tip.
    FastForward {
        /// The new tip.
        oid: String,
    },
    /// The remote's changes were merged with the folder's.
    Merged {
        /// The merge commit.
        oid: String,
    },
    /// Files changed on both sides; nothing was written.
    Conflict {
        /// The conflicting paths, sorted.
        files: Vec<String>,
    },
}

impl From<PullOutcome> for SyncPull {
    fn from(outcome: PullOutcome) -> Self {
        match outcome {
            PullOutcome::UpToDate => Self::UpToDate,
            PullOutcome::FastForward { oid } => Self::FastForward { oid },
            PullOutcome::Merged { oid } => Self::Merged { oid },
            PullOutcome::Conflict { files } => Self::Conflict { files },
        }
    }
}

/// What a push did, as the page sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SyncPush {
    /// Commits were sent.
    Pushed,
    /// The remote already has every commit.
    UpToDate,
    /// The remote refused the push.
    Rejected {
        /// Why, in plain words.
        reason: String,
    },
}

impl From<PushOutcome> for SyncPush {
    fn from(outcome: PushOutcome) -> Self {
        match outcome {
            PushOutcome::Pushed => Self::Pushed,
            PushOutcome::UpToDate => Self::UpToDate,
            PushOutcome::Rejected { reason } => Self::Rejected { reason },
        }
    }
}

/// The answer to a sync action, as the page sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultSyncReply {
    /// The remote URL as stored, if any.
    pub url: Option<String>,
    /// Whether a token is stored.
    pub has_token: bool,
    /// The remote's status, for `status` and `connect`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SyncStatus>,
    /// The pull's outcome, for `pull`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull: Option<SyncPull>,
    /// The push's outcome, for `push`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub push: Option<SyncPush>,
}

/// The stored sync settings. Read errors and empty values count as absent.
#[must_use]
pub fn read_settings(prefs: &Prefs, secrets: &Secrets) -> SyncSettings {
    SyncSettings {
        enabled: matches!(prefs.read("vault-git"), Ok(Some(PrefValue::Flag(true)))),
        url: non_empty(pref_text(prefs, "vault-git-remote")),
        token: non_empty(secrets.read("git-sync-token").ok().flatten()),
    }
}

fn pref_text(prefs: &Prefs, name: &str) -> Option<String> {
    match prefs.read(name) {
        Ok(Some(PrefValue::Text(text))) => Some(text),
        _ => None,
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.is_empty())
}

/// The remote URL the sync accepts: plain `https://host/path`, with no credentials in it.
///
/// # Errors
/// The reason to show the reader when the URL is refused.
pub fn check_git_remote_url(raw: Option<&str>) -> Result<String, String> {
    let text = raw
        .map(|text| text.trim_matches(crate::fetch::is_js_space))
        .filter(|text| !text.is_empty())
        .ok_or_else(|| NO_URL.to_owned())?;
    let url = Url::parse(text).map_err(|_| "That is not a URL.".to_owned())?;
    if url.scheme() != "https" {
        return Err("Only https:// remotes are supported.".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some_and(|p| !p.is_empty()) {
        return Err("Leave the token out of the URL; put it in the token field.".to_owned());
    }
    if url.host_str().is_none_or(str::is_empty) || matches!(url.path(), "" | "/") {
        return Err(NO_PATH.to_owned());
    }
    Ok(url.to_string())
}

/// The line to show for a git failure: git's own `fatal:` or `error:` lines, else the first line.
#[must_use]
pub fn git_reason(text: &str) -> String {
    let lines: Vec<&str> = text
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    let own: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|line| line.starts_with("fatal:") || line.starts_with("error:"))
        .collect();
    if !own.is_empty() {
        return own.join(" ");
    }
    let first = lines.first().copied().unwrap_or("");
    if first.is_empty() {
        FALLBACK_REASON.to_owned()
    } else {
        first.to_owned()
    }
}

/// Runs one sync action on the chosen folder.
///
/// # Errors
/// The reader-facing reason the action was refused or git failed, with the token removed.
pub async fn sync(
    queue: &GitQueue,
    ops: SyncOps,
    root: Option<PathBuf>,
    action: &str,
    settings: SyncSettings,
    timeout: Duration,
) -> Result<VaultSyncReply, String> {
    let root = root.ok_or_else(|| NO_ROOT.to_owned())?;
    let base = base_reply(&settings);
    if !SYNC_ACTIONS.contains(&action) {
        return Err(NOT_AN_ACTION.to_owned());
    }
    if action == "settings" {
        return Ok(base);
    }
    let state = if settings.enabled {
        probe_state(queue, ops, root.as_path(), timeout).await?
    } else {
        RepoState::None
    };
    let verdict = decide_commit(settings.enabled, &state)?;
    let url = check_git_remote_url(settings.url.as_deref())?;
    let config = RemoteConfig {
        url,
        token: settings.token.filter(|token| !token.is_empty()),
        username: None,
    };
    // Status never creates a repository, so a folder with none is answered without git.
    if action == "status" && verdict == CommitAction::Init {
        let mut reply = base;
        reply.status = Some(SyncStatus {
            url: None,
            branch: SYNC_BRANCH.to_owned(),
            ahead: 0,
            behind: 0,
        });
        return Ok(reply);
    }
    run_op(queue, ops, root, action, config, base, timeout).await
}

fn base_reply(settings: &SyncSettings) -> VaultSyncReply {
    VaultSyncReply {
        url: settings.url.clone(),
        has_token: settings.token.as_deref().is_some_and(|t| !t.is_empty()),
        status: None,
        pull: None,
        push: None,
    }
}

/// The line to show when the git queue gave no result.
#[must_use]
pub fn queued_reason(error: GitQueueError) -> String {
    match error {
        GitQueueError::TimedOut => GIT_TIMED_OUT.to_owned(),
        GitQueueError::Panicked => git_reason(""),
    }
}

async fn probe_state(
    queue: &GitQueue,
    ops: SyncOps,
    root: &Path,
    timeout: Duration,
) -> Result<RepoState, String> {
    let root = root.to_path_buf();
    queue
        .run(timeout, move || (ops.probe)(root.as_path()))
        .await
        .map_err(queued_reason)
}

async fn run_op(
    queue: &GitQueue,
    ops: SyncOps,
    root: PathBuf,
    action: &str,
    config: RemoteConfig,
    base: VaultSyncReply,
    timeout: Duration,
) -> Result<VaultSyncReply, String> {
    let token = config.token.clone();
    let username = config.username.clone();
    let action = action.to_owned();
    match queue
        .run(timeout, move || {
            run_action(ops, &root, &config, &action, base)
        })
        .await
    {
        Ok(Ok(reply)) => Ok(reply),
        Ok(Err(error)) => Err(redact_secret_for(
            &git_reason(&error.to_string()),
            token.as_deref(),
            username.as_deref(),
        )),
        Err(queued) => Err(queued_reason(queued)),
    }
}

/// One git call for `action`, made inside the queue.
fn run_action(
    ops: SyncOps,
    root: &Path,
    config: &RemoteConfig,
    action: &str,
    base: VaultSyncReply,
) -> Result<VaultSyncReply, RepoError> {
    let repo = FolderRepo::new(root);
    let mut reply = base;
    match action {
        "status" => reply.status = Some(SyncStatus::from((ops.status)(&repo, config)?)),
        "connect" => reply.status = Some(SyncStatus::from((ops.connect)(&repo, config)?)),
        "pull" => reply.pull = Some(SyncPull::from((ops.pull)(&repo, config)?)),
        "push" => reply.push = Some(SyncPush::from((ops.push)(&repo, config)?)),
        _ => {}
    }
    Ok(reply)
}

/// The folder's path, if a folder is chosen.
///
/// Locks in a blocking task: a file command may hold the lock through a long write.
async fn current_root(vault: &VaultState) -> Option<PathBuf> {
    let vault = vault.clone();
    tokio::task::spawn_blocking(move || vault.lock().root().map(|root| PathBuf::from(root.path)))
        .await
        .ok()
        .flatten()
}

/// Mirrors the chosen folder into its history now, when history is on.
///
/// # Errors
/// `NO_ROOT` when no folder is chosen.
pub async fn commit(
    queue: &GitQueue,
    vault: &VaultState,
    prefs: &Prefs,
) -> Result<CommitReply, String> {
    let enabled = matches!(prefs.read("vault-git"), Ok(Some(PrefValue::Flag(true))));
    commit_vault_folder(queue, current_root(vault).await, enabled, GIT_TIMEOUT).await
}

/// The chosen folder's commits, newest first.
///
/// # Errors
/// `NO_ROOT` when no folder is chosen.
pub async fn log(vault: &VaultState, limit: Option<f64>) -> Result<Vec<WorkspaceCommit>, String> {
    let root = current_root(vault)
        .await
        .ok_or_else(|| NO_ROOT.to_owned())?;
    let value = limit
        .and_then(serde_json::Number::from_f64)
        .map(serde_json::Value::Number);
    Ok(git_vault_log(root, log_limit(value.as_ref())).await)
}

/// Runs a sync action (settings, status, connect, pull or push) on the chosen folder.
///
/// # Errors
/// The reason to show the reader when the action is refused or git fails.
#[tauri::command]
#[specta::specta]
pub async fn vault_sync(
    queue: tauri::State<'_, GitQueue>,
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
    secrets: tauri::State<'_, Secrets>,
    action: String,
) -> Result<VaultSyncReply, ShellError> {
    // The keychain read can block, so it runs off the async runtime.
    let stored = prefs.inner().clone();
    let settings = secrets
        .queued(move |s| Ok(read_settings(&stored, s)))
        .await
        .map_err(ShellError::from)?;
    let root = current_root(vault.inner()).await;
    sync(
        queue.inner(),
        GIT_SYNC_OPS,
        root,
        &action,
        settings,
        GIT_TIMEOUT,
    )
    .await
    .map_err(ShellError::from)
}

/// Mirrors the chosen folder into its history now, when history is on.
///
/// # Errors
/// The reason to show the reader when no folder is chosen.
#[tauri::command]
#[specta::specta]
pub async fn vault_commit(
    queue: tauri::State<'_, GitQueue>,
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
) -> Result<CommitReply, ShellError> {
    commit(queue.inner(), vault.inner(), prefs.inner())
        .await
        .map_err(ShellError::from)
}

/// The chosen folder's commits, newest first.
///
/// # Errors
/// The reason to show the reader when no folder is chosen.
#[tauri::command]
#[specta::specta]
pub async fn vault_log(
    vault: tauri::State<'_, VaultState>,
    limit: Option<f64>,
) -> Result<Vec<WorkspaceCommit>, ShellError> {
    log(vault.inner(), limit).await.map_err(ShellError::from)
}

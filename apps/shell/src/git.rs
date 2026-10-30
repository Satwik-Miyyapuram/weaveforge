//! Vault history commands over wf-store's git. Ported from apps/desktop/src/vault-git.ts.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use wf_store::git::policy::RepoState;
use wf_store::git::repo::{Commit, CommitOutcome, FolderRepo, commit_vault, probe};

use crate::vault::NO_ROOT;

/// How long one git operation may take before the caller stops waiting.
pub const GIT_TIMEOUT: Duration = Duration::from_secs(30);
/// Commits returned when the page asks for no usable limit.
pub const DEFAULT_LOG_LIMIT: usize = 20;
/// Most commits one log request returns.
pub const MAX_LOG_LIMIT: usize = 200;
/// Reason given when git did not finish in time.
pub const GIT_TIMED_OUT: &str = "Git did not finish in time.";
/// Reason given when git panicked.
const GIT_FAILED: &str = "Git failed.";

/// One commit as the page sees it (TS `WorkspaceCommit`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommit {
    /// Full 40-hex object id.
    pub oid: String,
    /// Author time as ISO 8601 with offset.
    pub authored_at: String,
    /// Author name.
    pub author: String,
    /// First line of the message.
    pub message: String,
}

impl From<Commit> for WorkspaceCommit {
    fn from(commit: Commit) -> Self {
        Self {
            oid: commit.oid,
            authored_at: commit.authored_at,
            author: commit.author,
            message: commit.message,
        }
    }
}

/// The answer to a commit request (TS `{ commit, reason? }`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct CommitReply {
    /// The new commit, if one was made.
    pub commit: Option<WorkspaceCommit>,
    /// Why nothing was committed, if it was refused or failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// One git operation per process at a time (TS `serial`).
#[derive(Debug, Default)]
pub struct GitQueue {
    lock: Arc<tokio::sync::Mutex<()>>,
}

/// Why a queued git operation gave no result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitQueueError {
    /// The caller stopped waiting before git finished.
    TimedOut,
    /// The git work panicked.
    Panicked,
}

impl GitQueue {
    /// Runs `work` once earlier git work has finished; gives up waiting after `timeout`.
    ///
    /// The guard moves into the blocking task, so the lock is held until git really ends.
    ///
    /// # Errors
    /// `TimedOut` when waiting plus the work exceed `timeout`; `Panicked` when `work` panics.
    pub async fn run<T: Send + 'static>(
        &self,
        timeout: Duration,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, GitQueueError> {
        let outcome = tokio::time::timeout(timeout, async move {
            let guard = Arc::clone(&self.lock).lock_owned().await;
            let handle = tokio::task::spawn_blocking(move || {
                let _guard = guard;
                work()
            });
            handle.await
        })
        .await;
        match outcome {
            Err(_elapsed) => Err(GitQueueError::TimedOut),
            Ok(Err(_join_error)) => Err(GitQueueError::Panicked),
            Ok(Ok(value)) => Ok(value),
        }
    }
}

/// The commit count a log request asks for: integral and above zero, capped at 200.
#[must_use]
pub fn log_limit(limit: Option<&serde_json::Value>) -> usize {
    let Some(value) = limit else {
        return DEFAULT_LOG_LIMIT;
    };
    if let Some(n) = value.as_u64().filter(|n| *n > 0) {
        return usize::try_from(n).map_or(MAX_LOG_LIMIT, |n| n.min(MAX_LOG_LIMIT));
    }
    match value.as_f64() {
        Some(f) if f.fract() == 0.0 && f > 0.0 => {
            if f >= 200.0 {
                MAX_LOG_LIMIT
            } else {
                format!("{f}").parse::<usize>().unwrap_or(DEFAULT_LOG_LIMIT)
            }
        }
        _ => DEFAULT_LOG_LIMIT,
    }
}

/// The folder's own history, newest first; empty unless the folder is its own repository.
pub async fn vault_log(root: PathBuf, limit: usize) -> Vec<WorkspaceCommit> {
    tokio::task::spawn_blocking(move || {
        if probe(&root) == RepoState::Own {
            FolderRepo::new(&root)
                .log(Some(limit), None)
                .into_iter()
                .map(WorkspaceCommit::from)
                .collect()
        } else {
            Vec::new()
        }
    })
    .await
    .unwrap_or_default()
}

/// Mirrors the folder into its history when `enabled`, as TS `commitVaultFolder`.
///
/// Unlike TS, the probe runs inside the queue too; harmless, since probing only reads.
///
/// # Errors
/// `NO_ROOT` when no workspace folder is chosen.
pub async fn commit_vault_folder(
    queue: &GitQueue,
    root: Option<PathBuf>,
    enabled: bool,
    timeout: Duration,
) -> Result<CommitReply, String> {
    let root = root.ok_or_else(|| NO_ROOT.to_owned())?;
    let reply = match queue
        .run(timeout, move || commit_vault(&root, enabled))
        .await
    {
        Ok(outcome) => reply_from(outcome),
        Err(GitQueueError::TimedOut) => refused(GIT_TIMED_OUT),
        Err(GitQueueError::Panicked) => refused(GIT_FAILED),
    };
    Ok(reply)
}

fn reply_from(outcome: CommitOutcome) -> CommitReply {
    CommitReply {
        commit: outcome.commit.map(WorkspaceCommit::from),
        reason: outcome.reason,
    }
}

fn refused(reason: &str) -> CommitReply {
    CommitReply {
        commit: None,
        reason: Some(reason.to_owned()),
    }
}

//! Sync a folder repo with one https remote: status, pull, push. Ported from the remote half of apps/desktop/src/vault-git.ts.

use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::fs;

use git2::build::CheckoutBuilder;
use git2::{
    AutotagOption, CheckoutNotificationType, Cred, ErrorCode, FetchOptions, Index, Object,
    ObjectType, Oid, PushOptions, RemoteCallbacks, RemoteRedirect, Repository, Signature, Tree,
    TreeWalkMode, TreeWalkResult,
};

use crate::git::policy::{FileState, describe_changes};
use crate::git::repo::{Author, FolderRepo, RepoError, write_excludes};

/// Name of the remote WeaveForge adds; the user's own remotes (e.g. origin) are never touched.
pub const SYNC_REMOTE: &str = "weaveforge";
/// The only branch synced.
pub const SYNC_BRANCH: &str = "main";
/// Author of commits made by sync (pending changes, merges).
pub const SYNC_AUTHOR: Author<'static> = Author {
    name: "WeaveForge",
    email: "sync@weaveforge.local",
};
/// Why a push was refused when the remote has commits this folder lacks.
pub const PULL_FIRST: &str = "The remote has changes this folder does not. Pull first.";
/// Most commits counted when comparing with the remote; a larger count reads as the cap.
pub const WALK_CAP: usize = 100_000;

/// Where to sync and how to sign in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteConfig {
    /// The https URL, without the token.
    pub url: String,
    /// Sent as the password; never stored in the repo.
    pub token: Option<String>,
    /// Defaults to `x-access-token`; Overleaf uses `git`.
    pub username: Option<String>,
}

/// How this folder compares with the remote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteStatus {
    /// The remote URL, or `None` when the folder is not a repository.
    pub url: Option<String>,
    /// The branch synced.
    pub branch: String,
    /// Commits this folder has that the remote lacks.
    pub ahead: usize,
    /// Commits the remote has that this folder lacks.
    pub behind: usize,
}

/// What a pull did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PullOutcome {
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

/// What a push did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PushOutcome {
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

/// How this folder compares with its remote; never writes to the remote.
///
/// # Errors
/// When the folder or the remote cannot be read.
pub fn remote_status(repo: &FolderRepo, config: &RemoteConfig) -> Result<RemoteStatus, RepoError> {
    if !repo.is_repo() {
        return Ok(RemoteStatus {
            url: None,
            branch: repo.branch().to_owned(),
            ahead: 0,
            behind: 0,
        });
    }
    status_inner(repo, config).map_err(|e| redact_error(e, config))
}

fn status_inner(repo: &FolderRepo, config: &RemoteConfig) -> Result<RemoteStatus, RepoError> {
    let r = prepare(repo, config)?;
    let theirs = fetch(&r, config, repo.branch())?;
    let head = head_oid(&r)?;
    let (ahead, behind) = match (head, theirs) {
        (Some(h), None) => (count_reachable(&r, h)?, 0),
        (None, Some(t)) => (0, count_reachable(&r, t)?),
        (Some(h), Some(t)) => r.graph_ahead_behind(h, t)?,
        (None, None) => (0, 0),
    };
    Ok(RemoteStatus {
        url: Some(config.url.clone()),
        branch: repo.branch().to_owned(),
        ahead,
        behind,
    })
}

/// Brings the remote's changes into the folder, merging when both sides changed.
///
/// # Errors
/// When git cannot read or write the folder, or the remote cannot be reached.
pub fn pull(repo: &FolderRepo, config: &RemoteConfig) -> Result<PullOutcome, RepoError> {
    pull_inner(repo, config).map_err(|e| redact_error(e, config))
}

fn pull_inner(repo: &FolderRepo, config: &RemoteConfig) -> Result<PullOutcome, RepoError> {
    let r = prepare(repo, config)?;
    commit_pending(repo)?;
    let Some(theirs) = fetch(&r, config, repo.branch())? else {
        return Ok(PullOutcome::UpToDate);
    };
    let head = head_oid(&r)?;
    if let Some(h) = head
        && (h == theirs || r.graph_descendant_of(h, theirs)?)
    {
        return Ok(PullOutcome::UpToDate);
    }
    let head_files = match head {
        Some(h) => tree_files(&r.find_commit(h)?.tree()?)?,
        None => BTreeSet::new(),
    };
    let theirs_files = tree_files(&r.find_commit(theirs)?.tree()?)?;
    let collisions: Vec<String> = theirs_files
        .difference(&head_files)
        .filter(|path| fs::symlink_metadata(repo.root().join(path)).is_ok())
        .cloned()
        .collect();
    if !collisions.is_empty() {
        return Ok(PullOutcome::Conflict { files: collisions });
    }
    match head {
        Some(ours) if !r.graph_descendant_of(theirs, ours)? => {
            merge_into_head(&r, ours, theirs, repo.branch())
        }
        _ => fast_forward(&r, theirs),
    }
}

/// Local branch HEAD points to; the remote side is the folder's sync branch.
fn head_branch(r: &Repository) -> Result<String, RepoError> {
    r.find_reference("HEAD")?
        .symbolic_target()?
        .map(str::to_owned)
        .ok_or_else(|| RepoError::Git("HEAD is not on a branch.".to_owned()))
}

/// Checks out before moving the branch, so the files are written against the old HEAD.
fn fast_forward(r: &Repository, theirs: Oid) -> Result<PullOutcome, RepoError> {
    let branch = head_branch(r)?;
    let target = r.find_commit(theirs)?;
    if let Some(files) = checkout_safely(r, target.as_object())? {
        return Ok(PullOutcome::Conflict { files });
    }
    let _branch = r.reference(&branch, theirs, true, "sync: fast-forward")?;
    Ok(PullOutcome::FastForward {
        oid: theirs.to_string(),
    })
}

fn merge_into_head(
    r: &Repository,
    ours: Oid,
    theirs: Oid,
    branch: &str,
) -> Result<PullOutcome, RepoError> {
    let our_commit = r.find_commit(ours)?;
    let their_commit = r.find_commit(theirs)?;
    let mut index = r.merge_commits(&our_commit, &their_commit, None)?;
    if index.has_conflicts() {
        return Ok(PullOutcome::Conflict {
            files: conflict_paths(&index)?,
        });
    }
    let tree_id = index.write_tree_to(r)?;
    let tree = r.find_tree(tree_id)?;
    if let Some(files) = checkout_safely(r, tree.as_object())? {
        return Ok(PullOutcome::Conflict { files });
    }
    let sig = Signature::now(SYNC_AUTHOR.name, SYNC_AUTHOR.email)?;
    let oid = r.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("Merge {branch} from the remote"),
        &tree,
        &[&our_commit, &their_commit],
    )?;
    Ok(PullOutcome::Merged {
        oid: oid.to_string(),
    })
}

/// Sends the folder's commits to the remote, never forcing.
///
/// # Errors
/// When git cannot read or write the folder, or the remote cannot be reached.
pub fn push(repo: &FolderRepo, config: &RemoteConfig) -> Result<PushOutcome, RepoError> {
    push_inner(repo, config).map_err(|e| redact_error(e, config))
}

fn push_inner(repo: &FolderRepo, config: &RemoteConfig) -> Result<PushOutcome, RepoError> {
    let r = prepare(repo, config)?;
    commit_pending(repo)?;
    let Some(head) = head_oid(&r)? else {
        return Ok(PushOutcome::UpToDate);
    };
    let theirs = fetch(&r, config, repo.branch())?;
    if let Some(t) = theirs
        && (t == head || r.graph_descendant_of(t, head)?)
    {
        return Ok(PushOutcome::UpToDate);
    }
    if let Some(t) = theirs
        && !r.graph_descendant_of(head, t)?
    {
        return Ok(PushOutcome::Rejected {
            reason: PULL_FIRST.to_owned(),
        });
    }
    send(&r, config, repo.branch())
}

fn send(r: &Repository, config: &RemoteConfig, branch: &str) -> Result<PushOutcome, RepoError> {
    let refused = RefCell::new(None::<String>);
    let mut callbacks = callbacks(config);
    let _ = callbacks.push_update_reference(|_name, status| {
        if let Some(message) = status {
            *refused.borrow_mut() = Some(rejection_reason(message));
        }
        Ok(())
    });
    let mut options = PushOptions::new();
    let _ = options.remote_callbacks(callbacks);
    let _ = options.follow_redirects(RemoteRedirect::None);
    let mut remote = r.find_remote(SYNC_REMOTE)?;
    let refspec = format!("{}:refs/heads/{branch}", head_branch(r)?);
    let pushed = remote.push(&[refspec.as_str()], Some(&mut options));
    let refusal = refused.borrow().clone();
    if let Some(reason) = refusal {
        return Ok(PushOutcome::Rejected {
            reason: redact_secret_for(&reason, config.token.as_deref(), config.username.as_deref()),
        });
    }
    match pushed {
        Ok(()) => Ok(PushOutcome::Pushed),
        Err(error) => {
            let text = error.message().to_lowercase();
            if text.contains("non-fast-forward") || text.contains("fetch first") {
                Ok(PushOutcome::Rejected {
                    reason: PULL_FIRST.to_owned(),
                })
            } else {
                Err(error.into())
            }
        }
    }
}

/// One line for the Settings panel.
#[must_use]
pub fn describe_pull(outcome: &PullOutcome) -> String {
    match outcome {
        PullOutcome::UpToDate => "Already up to date.".to_owned(),
        PullOutcome::FastForward { .. } => "Pulled the remote's changes.".to_owned(),
        PullOutcome::Merged { .. } => "Merged the remote's changes with yours.".to_owned(),
        PullOutcome::Conflict { files } => {
            let n = files.len();
            let plural = if n == 1 { "" } else { "s" };
            let shown: Vec<&str> = files.iter().take(5).map(String::as_str).collect();
            let more = if n > 5 { ", …" } else { "" };
            format!(
                "Not pulled: {n} file{plural} changed on both sides ({}{more}). Your files were left as they were.",
                shown.join(", ")
            )
        }
    }
}

/// One line for the Settings panel.
#[must_use]
pub fn describe_push(outcome: &PushOutcome) -> String {
    match outcome {
        PushOutcome::Pushed => "Pushed.".to_owned(),
        PushOutcome::UpToDate => "Nothing to push.".to_owned(),
        PushOutcome::Rejected { reason } => format!("Not pushed: {reason}"),
    }
}

/// Removes a token from text before it is shown or logged (git echoes URLs and headers in errors).
#[must_use]
pub fn redact_secret(text: &str, secret: Option<&str>) -> String {
    redact_secret_for(text, secret, None)
}

/// Like `redact_secret`, also covering the base64 form with the configured username.
#[must_use]
pub fn redact_secret_for(text: &str, secret: Option<&str>, username: Option<&str>) -> String {
    let Some(secret) = secret.filter(|s| !s.is_empty()) else {
        return text.to_owned();
    };
    let mut users: Vec<&str> = username.filter(|u| !u.is_empty()).into_iter().collect();
    users.extend(["x-access-token", "git"]);
    let mut out = text.to_owned();
    for user in users {
        let encoded = base64(format!("{user}:{secret}").as_bytes());
        out = out.replace(&encoded, "***");
    }
    out.replace(secret, "***")
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with `=` padding; hand-rolled so no crate is needed for one redaction.
fn base64(bytes: &[u8]) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let byte = |i: usize| u32::from(chunk.get(i).copied().unwrap_or(0));
        let n = (byte(0) << 16) | (byte(1) << 8) | byte(2);
        let kept = chunk.len() + 1;
        for index in 0..4 {
            if index < kept {
                let sextet = usize::try_from((n >> (18 - 6 * index)) & 63).unwrap_or(0);
                let symbol = BASE64_ALPHABET.get(sextet).copied().unwrap_or(b'=');
                out.push(char::from(symbol));
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn redact_error(error: RepoError, config: &RemoteConfig) -> RepoError {
    match error {
        RepoError::Git(message) => RepoError::Git(redact_secret_for(
            &message,
            config.token.as_deref(),
            config.username.as_deref(),
        )),
        other => other,
    }
}

/// True only when `asked_url` is on the configured https host; the token may only go there.
#[must_use]
pub fn token_may_go_to(config_url: &str, asked_url: &str) -> bool {
    let (Some((scheme, host)), Some((asked_scheme, asked_host))) =
        (split_url(config_url), split_url(asked_url))
    else {
        return false;
    };
    scheme == "https" && scheme == asked_scheme && host == asked_host
}

/// Lowercased scheme and host (with port) of `url`, userinfo dropped.
fn split_url(url: &str) -> Option<(String, String)> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split('/').next()?;
    let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    Some((scheme.to_lowercase(), host.to_lowercase()))
}

/// The one-line reason for a refused push; hook and protection messages are shown as given.
#[must_use]
pub fn rejection_reason(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("non-fast-forward") || lower.contains("fetch first") {
        return PULL_FIRST.to_owned();
    }
    format!("The remote refused the push: {}", message.trim())
}

/// Makes sure the folder is a repository with the sync remote pointing at `config.url`.
fn prepare(repo: &FolderRepo, config: &RemoteConfig) -> Result<Repository, RepoError> {
    if !repo.is_repo() {
        repo.init()?;
    }
    let r = repo.open()?;
    if let Err(error) = r.head()
        && error.code() == ErrorCode::UnbornBranch
    {
        r.set_head(&format!("refs/heads/{}", repo.branch()))?;
    }
    write_excludes(&r)?;
    match r.find_remote(SYNC_REMOTE) {
        Ok(existing) => {
            if existing.url() != Ok(config.url.as_str()) {
                r.remote_set_url(SYNC_REMOTE, &config.url)?;
            }
        }
        Err(error) if error.code() == ErrorCode::NotFound => {
            let _remote = r.remote(SYNC_REMOTE, &config.url)?;
        }
        Err(error) => return Err(error.into()),
    }
    Ok(r)
}

/// Credentials for the sync remote; a refused token fails instead of looping.
fn callbacks<'a>(config: &RemoteConfig) -> RemoteCallbacks<'a> {
    let token = config.token.clone();
    let user = config
        .username
        .clone()
        .unwrap_or_else(|| "x-access-token".to_owned());
    let config_url = config.url.clone();
    let asked = Cell::new(0_u8);
    let mut callbacks = RemoteCallbacks::new();
    let _ = callbacks.credentials(move |url, _from, _allowed| {
        let attempt = asked.get();
        asked.set(attempt.saturating_add(1));
        match &token {
            None => Err(git2::Error::from_str(
                "The remote asked for a sign-in; add a token.",
            )),
            Some(_) if !token_may_go_to(&config_url, url) => Err(git2::Error::from_str(
                "The remote asked for a sign-in from another host.",
            )),
            Some(_) if attempt > 0 => Err(git2::Error::from_str("The token was refused.")),
            Some(secret) => Cred::userpass_plaintext(&user, secret),
        }
    });
    callbacks
}

/// Fetches the remote's sync branch; `None` when the remote has no such branch yet.
fn fetch(r: &Repository, config: &RemoteConfig, branch: &str) -> Result<Option<Oid>, RepoError> {
    let mut remote = r.find_remote(SYNC_REMOTE)?;
    let mut options = FetchOptions::new();
    let _ = options.remote_callbacks(callbacks(config));
    let _ = options
        .download_tags(AutotagOption::None)
        .follow_redirects(RemoteRedirect::None);
    let refspec = format!("+refs/heads/{branch}:refs/remotes/{SYNC_REMOTE}/{branch}");
    remote.fetch(&[refspec.as_str()], Some(&mut options), None)?;
    match r.find_reference(&format!("refs/remotes/{SYNC_REMOTE}/{branch}")) {
        Ok(reference) => Ok(reference.target()),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Commits the folder's permitted pending changes under the sync author.
fn commit_pending(repo: &FolderRepo) -> Result<(), RepoError> {
    let changes = repo.status()?;
    if changes.is_empty() {
        return Ok(());
    }
    let states: Vec<FileState> = changes.iter().map(|change| change.state).collect();
    let _committed = repo.commit_all(&describe_changes(&states), SYNC_AUTHOR)?;
    Ok(())
}

/// The commit HEAD points at, or `None` when the branch is unborn.
fn head_oid(r: &Repository) -> Result<Option<Oid>, RepoError> {
    match r.head() {
        Ok(reference) => Ok(Some(reference.peel_to_commit()?.id())),
        Err(error) if matches!(error.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => {
            Ok(None)
        }
        Err(error) => Err(error.into()),
    }
}

fn count_reachable(r: &Repository, from: Oid) -> Result<usize, RepoError> {
    let mut walk = r.revwalk()?;
    walk.push(from)?;
    Ok(walk
        .take(WALK_CAP)
        .collect::<Result<Vec<Oid>, git2::Error>>()?
        .len())
}

/// Checks out `target` without overwriting local work; `Some(paths)` lists what blocked it.
fn checkout_safely(r: &Repository, target: &Object<'_>) -> Result<Option<Vec<String>>, RepoError> {
    let blocked = RefCell::new(Vec::<String>::new());
    let result = {
        let mut builder = CheckoutBuilder::new();
        let _ = builder
            .safe()
            .notify_on(CheckoutNotificationType::CONFLICT)
            .notify(|_kind, path, _old, _new, _work| {
                if let Some(path) = path {
                    blocked
                        .borrow_mut()
                        .push(path.to_string_lossy().replace('\\', "/"));
                }
                true
            });
        r.checkout_tree(target, Some(&mut builder))
    };
    let mut files = blocked.into_inner();
    match result {
        Ok(()) => Ok(None),
        Err(error) if error.code() == ErrorCode::Conflict || !files.is_empty() => {
            files.sort();
            files.dedup();
            Ok(Some(files))
        }
        Err(error) => Err(error.into()),
    }
}

/// Every blob path under `tree`, sorted.
fn tree_files(tree: &Tree<'_>) -> Result<BTreeSet<String>, git2::Error> {
    let mut files = BTreeSet::new();
    tree.walk(TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() == Some(ObjectType::Blob)
            && let Ok(name) = entry.name()
        {
            let _ = files.insert(format!("{dir}{name}"));
        }
        TreeWalkResult::Ok
    })?;
    Ok(files)
}

/// The our-side and their-side paths of every conflict in `index`, sorted and deduplicated.
fn conflict_paths(index: &Index) -> Result<Vec<String>, RepoError> {
    let mut paths = BTreeSet::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        for entry in [conflict.our, conflict.their].into_iter().flatten() {
            let _ = paths.insert(String::from_utf8_lossy(&entry.path).into_owned());
        }
    }
    Ok(paths.into_iter().collect())
}

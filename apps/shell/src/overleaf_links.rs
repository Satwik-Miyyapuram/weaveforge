//! Overleaf sync links: the folder rules, the stored link list, the list, link and unlink actions, and the git status, pull and push.

use std::fmt::Write as _;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;
use sha2::{Digest as _, Sha256};
use wf_store::git::remote::{RemoteConfig, pull, push, redact_secret_for, remote_status};
use wf_store::git::repo::{FolderRepo, RepoError};

use crate::commands::ShellError;
use crate::fetch::is_js_space;
use crate::git::{GIT_TIMEOUT, GitQueue};
use crate::launch::without_verbatim_prefix;
use crate::prefs::{PrefValue, Prefs};
use crate::secrets::Secrets;
use crate::vault::{NO_ROOT, VaultState};
use crate::vault_sync::{SyncPull, SyncPush, SyncStatus, git_reason, queued_reason};

/// The preference that keeps the links as JSON text; the same name the desktop shell used.
const LINKS_PREF: &str = "overleaf-links";
/// The keychain name of the Overleaf git token.
const TOKEN_SECRET: &str = "overleaf-token";
/// The user name Overleaf's git server takes with the token as the password.
const USERNAME: &str = "git";
/// The Overleaf git server; a project's repository is at this URL plus its id.
pub const OVERLEAF_GIT_URL: &str = "https://git.overleaf.com/";
/// The branch Overleaf keeps a project's files on.
pub const OVERLEAF_BRANCH: &str = "master";

/// Refused action name.
pub const NOT_AN_ACTION: &str = "That is not an Overleaf sync action.";
/// Shown for a git action before a token is stored.
pub const NO_TOKEN: &str =
    "Add your Overleaf git token first (Overleaf → Account settings → Git integration).";
/// Shown for a git action on a project with no link.
pub const NOT_LINKED: &str = "That Overleaf project is not linked to a folder.";
/// Shown when the project id cannot be read from what was pasted.
pub const BAD_PROJECT: &str = "Paste the Overleaf project's URL or id.";
/// Shown when a link folder fails the folder rules.
pub const BAD_FOLDER: &str = "Choose a folder inside the vault, like Overleaf/thesis.";
/// Shown when a folder leaves the vault, or a folder that exists is a link out of it.
pub const OUTSIDE: &str = "That folder is outside the vault.";
/// Shown when the project already has a link.
pub const ALREADY_LINKED: &str = "That project is already linked to a folder.";
/// Shown when a folder is, holds, or sits inside another link's folder.
pub const FOLDER_TAKEN: &str =
    "That folder is already synced with another project, or holds or sits inside one.";

/// One Overleaf project linked to a vault folder.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverleafLink {
    /// The Overleaf project id.
    pub project_id: String,
    /// The vault-relative folder, with forward slashes.
    pub folder: String,
}

/// What the page reads back from an Overleaf sync action. Link actions leave the git fields unset.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverleafSyncReply {
    /// The links after the action.
    pub links: Vec<OverleafLink>,
    /// Whether an Overleaf git token is stored.
    pub has_token: bool,
    /// The remote's status, for `status`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SyncStatus>,
    /// The pull's outcome, for `pull`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull: Option<SyncPull>,
    /// The push's outcome, for `push`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub push: Option<SyncPush>,
}

/// Where the Overleaf git repositories live, and the URL prefix the project id is appended to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverleafGit {
    /// The folder that holds one git directory per linked folder.
    pub store: PathBuf,
    /// The remote URL prefix; the project id is appended to it.
    pub remote_base: String,
}

/// The stores and git queue an Overleaf sync action runs against.
pub struct OverleafDeps<'a> {
    /// The preference file that keeps the links.
    pub prefs: &'a Prefs,
    /// The keychain that keeps the token.
    pub secrets: &'a Secrets,
    /// The chosen vault folder.
    pub vault: &'a VaultState,
    /// The queue that runs git one operation at a time.
    pub queue: &'a GitQueue,
}

/// A vault-relative folder with forward slashes: no `.`/`..` steps, no drive or absolute
/// path, nothing in `.weaveforge` or a `.git`.
///
/// # Errors
/// `BAD_FOLDER` when the folder breaks one of those rules.
pub fn check_link_folder(raw: &str) -> Result<String, String> {
    let folder = raw.trim_matches(is_js_space).trim_end_matches('/');
    if folder.is_empty()
        || folder.encode_utf16().count() > 200
        || folder.starts_with('/')
        || folder.contains(['\\', ':'])
    {
        return Err(BAD_FOLDER.to_owned());
    }
    let parts: Vec<&str> = folder.split('/').collect();
    let bad_step = parts
        .iter()
        .any(|part| matches!(*part, "" | "." | ".." | ".git"));
    if bad_step || parts.first() == Some(&".weaveforge") {
        return Err(BAD_FOLDER.to_owned());
    }
    Ok(folder.to_owned())
}

/// The links kept in a stored JSON value, dropping every entry that is malformed.
#[must_use]
pub fn parse_links(value: &Value) -> Vec<OverleafLink> {
    let Some(entries) = value.as_array() else {
        return Vec::new();
    };
    entries.iter().filter_map(stored_link).collect()
}

fn stored_link(entry: &Value) -> Option<OverleafLink> {
    let project_id = entry.get("projectId")?.as_str()?;
    let folder = check_link_folder(entry.get("folder")?.as_str()?).ok()?;
    if !is_project_id(project_id) {
        return None;
    }
    Some(OverleafLink {
        project_id: project_id.to_owned(),
        folder,
    })
}

/// The path under `vault_root` that `folder` names, refused when it leaves the vault.
///
/// # Errors
/// `OUTSIDE` when the folder steps out of the vault, or an existing folder is a link out of it or to the vault itself.
pub fn inside_vault(vault_root: &Path, folder: &str) -> Result<PathBuf, String> {
    let target = lexical_target(vault_root, folder).ok_or_else(|| OUTSIDE.to_owned())?;
    let real_root = std::fs::canonicalize(vault_root).map_err(|_| OUTSIDE.to_owned())?;
    // A folder that already exists may be a link out of the vault; follow it.
    match std::fs::canonicalize(&target) {
        Ok(real) if real == real_root || !real.starts_with(&real_root) => Err(OUTSIDE.to_owned()),
        _ => Ok(target),
    }
}

/// The folder joined onto the root, with `.` skipped and `..` taken back; `None` on any escape.
fn lexical_target(vault_root: &Path, folder: &str) -> Option<PathBuf> {
    let mut target = vault_root.to_path_buf();
    let mut depth = 0_usize;
    for component in Path::new(folder).components() {
        match component {
            Component::Normal(part) => {
                target.push(part);
                depth += 1;
            }
            Component::ParentDir if depth > 0 => {
                let _ = target.pop();
                depth -= 1;
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    (depth > 0).then_some(target)
}

/// The link list after `action`. `list` changes nothing; `link` and `unlink` change the list;
/// `status`, `pull` and `push` only pass the link check here, and `overleaf_sync_with` runs git.
///
/// # Errors
/// The reader-facing reason the action is refused.
pub fn apply_link_action(
    links: &[OverleafLink],
    action: &str,
    project: Option<&str>,
    folder: Option<&str>,
) -> Result<Vec<OverleafLink>, String> {
    match action {
        "list" => Ok(links.to_vec()),
        "link" => link_project(links, project, folder),
        "unlink" => unlink_project(links, project),
        "status" | "pull" | "push" => match linked_folder(links, project) {
            Some(_) => Ok(links.to_vec()),
            None => Err(NOT_LINKED.to_owned()),
        },
        _ => Err(NOT_AN_ACTION.to_owned()),
    }
}

fn link_project(
    links: &[OverleafLink],
    project: Option<&str>,
    folder: Option<&str>,
) -> Result<Vec<OverleafLink>, String> {
    let id = project
        .and_then(project_id_from)
        .ok_or_else(|| BAD_PROJECT.to_owned())?;
    let raw = match folder {
        None | Some("") => format!("Overleaf/{id}"),
        Some(text) => text.to_owned(),
    };
    let folder = check_link_folder(&raw)?;
    if links.iter().any(|link| link.project_id == id) {
        return Err(ALREADY_LINKED.to_owned());
    }
    if links.iter().any(|link| overlaps(&link.folder, &folder)) {
        return Err(FOLDER_TAKEN.to_owned());
    }
    let mut next = links.to_vec();
    next.push(OverleafLink {
        project_id: id,
        folder,
    });
    Ok(next)
}

fn unlink_project(
    links: &[OverleafLink],
    project: Option<&str>,
) -> Result<Vec<OverleafLink>, String> {
    // Forgets the link only: the files stay in the vault and on Overleaf.
    let next: Vec<OverleafLink> = links
        .iter()
        .filter(|link| Some(link.project_id.as_str()) != project)
        .cloned()
        .collect();
    if next.len() == links.len() {
        return Err(NOT_LINKED.to_owned());
    }
    Ok(next)
}

fn linked_folder(links: &[OverleafLink], project: Option<&str>) -> Option<String> {
    links
        .iter()
        .find(|link| Some(link.project_id.as_str()) == project)
        .map(|link| link.folder.clone())
}

/// Equal folders, or one inside the other in either direction.
fn overlaps(a: &str, b: &str) -> bool {
    a == b || inside(a, b) || inside(b, a)
}

/// Whether `inner` is a folder below `outer`.
fn inside(inner: &str, outer: &str) -> bool {
    inner
        .strip_prefix(outer)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// The project id from a pasted id, project page or git URL; `None` for anything else.
fn project_id_from(raw: &str) -> Option<String> {
    let text = raw.trim_matches(is_js_space);
    if is_project_id(text) {
        return Some(text.to_owned());
    }
    let url = reqwest::Url::parse(text).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some_and(|p| !p.is_empty())
    {
        return None;
    }
    let parts: Vec<&str> = url.path().split('/').filter(|p| !p.is_empty()).collect();
    let id = match (url.host_str()?, parts.as_slice()) {
        ("git.overleaf.com", [id]) => *id,
        ("overleaf.com" | "www.overleaf.com", ["project", id]) => *id,
        _ => return None,
    };
    if is_project_id(id) {
        Some(id.to_owned())
    } else {
        None
    }
}

/// Overleaf project ids: non-empty, letters, digits, `_` and `-` only.
fn is_project_id(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The git directory for one linked folder: `<store>/<12 hex of SHA-256(root, folder)>-<project id>.git`.
///
/// The root is spelled as Electron's `path.resolve` spelled it, so a link made
/// there finds the same directory: no verbatim prefix, no trailing separator,
/// and backslashes on Windows.
#[must_use]
pub fn overleaf_git_dir(store: &Path, root: &Path, folder: &str, project_id: &str) -> PathBuf {
    let root_text = resolved_root(root);
    let mut hasher = Sha256::new();
    hasher.update(root_text.as_bytes());
    hasher.update([0_u8]);
    hasher.update(folder.as_bytes());
    let mut hash = String::with_capacity(12);
    for byte in hasher.finalize().iter().take(6) {
        let _ = write!(hash, "{byte:02x}");
    }
    store.join(format!("{hash}-{project_id}.git"))
}

/// `root` the way Node's `path.resolve` writes an absolute folder.
fn resolved_root(root: &Path) -> String {
    let text = without_verbatim_prefix(root).to_string_lossy().into_owned();
    let (text, sep) = if cfg!(windows) {
        (text.replace('/', "\\"), '\\')
    } else {
        (text, '/')
    };
    let trimmed = text.trim_end_matches(sep);
    // A drive or filesystem root keeps its separator: `C:\`, `/`.
    if trimmed.is_empty() || (cfg!(windows) && trimmed.ends_with(':')) {
        format!("{trimmed}{sep}")
    } else {
        trimmed.to_owned()
    }
}

/// The vault folder the shell has chosen, if any.
fn vault_root(vault: &VaultState) -> Option<PathBuf> {
    vault.lock().root().map(|root| PathBuf::from(root.path))
}

/// The stored links; an unreadable or malformed value counts as none.
fn stored_links(prefs: &Prefs) -> Vec<OverleafLink> {
    match prefs.read(LINKS_PREF) {
        Ok(Some(PrefValue::Text(text))) => match serde_json::from_str::<Value>(&text) {
            Ok(value) => parse_links(&value),
            Err(_) => Vec::new(),
        },
        _ => Vec::new(),
    }
}

fn write_links(prefs: &Prefs, links: &[OverleafLink]) -> Result<(), String> {
    let text = serde_json::to_string(links).map_err(|e| e.to_string())?;
    prefs
        .write(LINKS_PREF, Some(PrefValue::Text(text)))
        .map_err(|e| e.to_string())
}

/// The stored Overleaf git token; an empty or unreadable value counts as none.
fn token_text(secrets: &Secrets) -> Option<String> {
    secrets
        .read(TOKEN_SECRET)
        .ok()
        .flatten()
        .filter(|token| !token.is_empty())
}

/// The checks that run before a git action, in the order the desktop shell runs them.
fn check_before_git(
    root: &Path,
    links: &[OverleafLink],
    project: Option<&str>,
    has_token: bool,
) -> Result<(), String> {
    if !has_token {
        return Err(NO_TOKEN.to_owned());
    }
    let folder = linked_folder(links, project).ok_or_else(|| NOT_LINKED.to_owned())?;
    inside_vault(root, &folder).map(|_| ())
}

/// Which git step a status, pull or push action runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitAction {
    Status,
    Pull,
    Push,
}

impl GitAction {
    fn parse(action: &str) -> Option<Self> {
        match action {
            "status" => Some(Self::Status),
            "pull" => Some(Self::Pull),
            "push" => Some(Self::Push),
            _ => None,
        }
    }
}

/// One git step: the action, the repository, the remote and the reply to fill in.
struct GitPlan {
    action: GitAction,
    repo: FolderRepo,
    config: RemoteConfig,
    base: OverleafSyncReply,
}

/// What the blocking checks leave to do: a finished reply, or a git step for the queue.
enum Step {
    Done(OverleafSyncReply),
    Git(Box<GitPlan>),
}

/// Runs an Overleaf sync action against the stored links, token and chosen folder.
///
/// # Errors
/// The reader-facing reason the action is refused, or git failed with the token removed.
pub async fn overleaf_sync_with(
    deps: &OverleafDeps<'_>,
    git: &OverleafGit,
    action: String,
    project_id: Option<String>,
    folder: Option<String>,
) -> Result<OverleafSyncReply, String> {
    // The vault lock, the keychain and the preference file all block; keep them off the runtime.
    let (prefs, secrets, vault, git) = (
        deps.prefs.clone(),
        deps.secrets.clone(),
        deps.vault.clone(),
        git.clone(),
    );
    let step = tokio::task::spawn_blocking(move || {
        sync_blocking(
            &prefs,
            &secrets,
            &vault,
            &git,
            &action,
            project_id.as_deref(),
            folder.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    match step {
        Step::Done(reply) => Ok(reply),
        Step::Git(plan) => run_git(deps.queue, *plan).await,
    }
}

/// The checks and local writes of a sync action, run on a blocking thread.
fn sync_blocking(
    prefs: &Prefs,
    secrets: &Secrets,
    vault: &VaultState,
    git: &OverleafGit,
    action: &str,
    project: Option<&str>,
    folder: Option<&str>,
) -> Result<Step, String> {
    let root = vault_root(vault).ok_or_else(|| NO_ROOT.to_owned())?;
    let links = stored_links(prefs);
    let token = token_text(secrets);
    let has_token = token.is_some();
    let next = apply_link_action(&links, action, project, folder)?;
    match GitAction::parse(action) {
        Some(git_action) => {
            let plan = git_plan(&root, &links, git, git_action, project, token)?;
            Ok(Step::Git(Box::new(plan)))
        }
        None => {
            write_link_change(prefs, &root, action, &next)?;
            Ok(Step::Done(OverleafSyncReply {
                links: next,
                has_token,
                status: None,
                pull: None,
                push: None,
            }))
        }
    }
}

/// Saves the link list a `link` or `unlink` action produced; a new link must sit inside the vault.
fn write_link_change(
    prefs: &Prefs,
    root: &Path,
    action: &str,
    next: &[OverleafLink],
) -> Result<(), String> {
    match action {
        "link" => {
            if let Some(added) = next.last() {
                let _ = inside_vault(root, &added.folder)?;
            }
            write_links(prefs, next)
        }
        "unlink" => write_links(prefs, next),
        _ => Ok(()),
    }
}

/// The checks a git action passes, then the repository and remote it runs against.
fn git_plan(
    root: &Path,
    links: &[OverleafLink],
    git: &OverleafGit,
    action: GitAction,
    project: Option<&str>,
    token: Option<String>,
) -> Result<GitPlan, String> {
    check_before_git(root, links, project, token.is_some())?;
    let id = project.ok_or_else(|| NOT_LINKED.to_owned())?;
    let folder = linked_folder(links, project).ok_or_else(|| NOT_LINKED.to_owned())?;
    let token = token.ok_or_else(|| NO_TOKEN.to_owned())?;
    let folder_path = inside_vault(root, &folder)?;
    if action != GitAction::Status {
        std::fs::create_dir_all(&folder_path)
            .and_then(|()| std::fs::create_dir_all(&git.store))
            .map_err(|e| e.to_string())?;
    }
    let config = RemoteConfig {
        url: format!("{}{id}", git.remote_base),
        token: Some(token),
        username: Some(USERNAME.to_owned()),
    };
    let repo = FolderRepo::new(&folder_path)
        .with_git_dir(overleaf_git_dir(&git.store, root, &folder, id))
        .with_branch(OVERLEAF_BRANCH);
    Ok(GitPlan {
        action,
        repo,
        config,
        base: OverleafSyncReply {
            links: links.to_vec(),
            has_token: true,
            status: None,
            pull: None,
            push: None,
        },
    })
}

/// Runs one git step inside the queue, then maps a failure to a reader-facing reason.
async fn run_git(queue: &GitQueue, plan: GitPlan) -> Result<OverleafSyncReply, String> {
    let token = plan.config.token.clone();
    let username = plan.config.username.clone();
    match queue.run(GIT_TIMEOUT, move || run_remote(plan)).await {
        Ok(Ok(reply)) => Ok(reply),
        Ok(Err(error)) => Err(redact_secret_for(
            &git_reason(&error.to_string()),
            token.as_deref(),
            username.as_deref(),
        )),
        Err(queued) => Err(queued_reason(queued)),
    }
}

/// One git call for the plan's action, made inside the queue.
fn run_remote(plan: GitPlan) -> Result<OverleafSyncReply, RepoError> {
    let mut reply = plan.base;
    match plan.action {
        GitAction::Status => {
            reply.status = Some(SyncStatus::from(remote_status(&plan.repo, &plan.config)?));
        }
        GitAction::Pull => reply.pull = Some(SyncPull::from(pull(&plan.repo, &plan.config)?)),
        GitAction::Push => reply.push = Some(SyncPush::from(push(&plan.repo, &plan.config)?)),
    }
    Ok(reply)
}

/// Runs an Overleaf sync action on the chosen folder.
///
/// # Errors
/// The reason to show the reader when the action is refused or git fails.
#[tauri::command]
#[specta::specta]
// The page's invoke call names each argument, so the queue and app handle stay separate arguments.
#[allow(clippy::too_many_arguments)]
pub async fn overleaf_sync(
    app: tauri::AppHandle,
    prefs: tauri::State<'_, Prefs>,
    secrets: tauri::State<'_, Secrets>,
    vault: tauri::State<'_, VaultState>,
    queue: tauri::State<'_, GitQueue>,
    action: String,
    project_id: Option<String>,
    folder: Option<String>,
) -> Result<OverleafSyncReply, ShellError> {
    use tauri::Manager as _;
    let store = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("overleaf-git");
    let git = OverleafGit {
        store,
        remote_base: OVERLEAF_GIT_URL.to_owned(),
    };
    let deps = OverleafDeps {
        prefs: prefs.inner(),
        secrets: secrets.inner(),
        vault: vault.inner(),
        queue: queue.inner(),
    };
    overleaf_sync_with(&deps, &git, action, project_id, folder)
        .await
        .map_err(ShellError::from)
}

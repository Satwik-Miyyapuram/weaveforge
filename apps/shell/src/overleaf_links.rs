//! Overleaf sync links: the folder rules, the stored link list, and the list, link and unlink actions.

use std::path::{Component, Path, PathBuf};

use serde_json::Value;

use crate::commands::ShellError;
use crate::fetch::is_js_space;
use crate::prefs::{PrefValue, Prefs};
use crate::secrets::Secrets;
use crate::vault::{NO_ROOT, VaultState};

/// The preference that keeps the links as JSON text; the same name the desktop shell used.
const LINKS_PREF: &str = "overleaf-links";
/// The keychain name of the Overleaf git token.
const TOKEN_SECRET: &str = "overleaf-token";

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
/// Shown for status, pull and push: the git step is not in this build yet.
pub const NOT_YET: &str = "Overleaf sync is not available in this build yet.";

/// One Overleaf project linked to a vault folder.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverleafLink {
    /// The Overleaf project id.
    pub project_id: String,
    /// The vault-relative folder, with forward slashes.
    pub folder: String,
}

/// What the page reads back from an Overleaf sync action.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverleafSyncReply {
    /// The links after the action.
    pub links: Vec<OverleafLink>,
    /// Whether an Overleaf git token is stored.
    pub has_token: bool,
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
/// `status`, `pull` and `push` pass their pre-git checks and then stop with `NOT_YET`.
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
            Some(_) => Err(NOT_YET.to_owned()),
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

fn has_token(secrets: &Secrets) -> bool {
    secrets
        .read(TOKEN_SECRET)
        .ok()
        .flatten()
        .is_some_and(|token| !token.is_empty())
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

/// Runs an Overleaf sync action against the stored links, token and chosen folder.
///
/// # Errors
/// The reader-facing reason the action is refused, or `NOT_YET` for a git action.
pub async fn overleaf_sync_with(
    prefs: &Prefs,
    secrets: &Secrets,
    vault: &VaultState,
    action: String,
    project_id: Option<String>,
    folder: Option<String>,
) -> Result<OverleafSyncReply, String> {
    // The vault lock, the keychain and the preference file all block; keep them off the runtime.
    let (prefs, secrets, vault) = (prefs.clone(), secrets.clone(), vault.clone());
    tokio::task::spawn_blocking(move || {
        sync_blocking(
            &prefs,
            &secrets,
            &vault,
            &action,
            project_id.as_deref(),
            folder.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The body of `overleaf_sync_with`, run on a blocking thread.
fn sync_blocking(
    prefs: &Prefs,
    secrets: &Secrets,
    vault: &VaultState,
    action: &str,
    project: Option<&str>,
    folder: Option<&str>,
) -> Result<OverleafSyncReply, String> {
    let root = vault_root(vault).ok_or_else(|| NO_ROOT.to_owned())?;
    let links = stored_links(prefs);
    let has_token = has_token(secrets);
    let next = match apply_link_action(&links, action, project, folder) {
        Err(reason) if reason == NOT_YET => {
            check_before_git(&root, &links, project, has_token)?;
            return Err(NOT_YET.to_owned());
        }
        other => other?,
    };
    match action {
        "link" => {
            if let Some(added) = next.last() {
                let _ = inside_vault(&root, &added.folder)?;
            }
            write_links(prefs, &next)?;
        }
        "unlink" => write_links(prefs, &next)?,
        _ => {}
    }
    Ok(OverleafSyncReply {
        links: next,
        has_token,
    })
}

/// Runs an Overleaf sync action on the chosen folder.
///
/// # Errors
/// The reason to show the reader when the action is refused or not yet available.
#[tauri::command]
#[specta::specta]
pub async fn overleaf_sync(
    prefs: tauri::State<'_, Prefs>,
    secrets: tauri::State<'_, Secrets>,
    vault: tauri::State<'_, VaultState>,
    action: String,
    project_id: Option<String>,
    folder: Option<String>,
) -> Result<OverleafSyncReply, ShellError> {
    overleaf_sync_with(
        prefs.inner(),
        secrets.inner(),
        vault.inner(),
        action,
        project_id,
        folder,
    )
    .await
    .map_err(ShellError::from)
}

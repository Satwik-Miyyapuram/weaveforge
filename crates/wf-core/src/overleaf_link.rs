//! Overleaf link rules for the desktop sync: which vault folder a project may sync into, and
//! how the stored list of links is read back. Pure: the git bridge and the file reads stay in
//! the desktop shell.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::overleaf::is_valid_project_id;

/// Longest accepted folder, in UTF-16 units (matches the JS client).
const MAX_FOLDER_UTF16: usize = 200;

/// The reason every refused folder gets.
const BAD_FOLDER: &str = "Choose a folder inside the vault, like Overleaf/thesis.";

/// One Overleaf project linked to a vault folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverleafLink {
    /// The Overleaf project id.
    pub project_id: String,
    /// The vault-relative folder, with forward slashes.
    pub folder: String,
}

/// The outcome of checking a link folder.
///
/// Serialises as `{ ok: true, folder }` or `{ ok: false, reason }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkFolderCheck {
    /// Whether the folder may be linked.
    pub ok: bool,
    /// The normalised folder, when `ok`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub folder: Option<String>,
    /// Why the folder was refused, when not `ok`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reason: Option<String>,
}

/// Check a vault-relative folder: forward slashes, no `.` or `..` steps, no drive or absolute
/// path, and nothing in `.weaveforge` (the app's own files) or a `.git`. Trailing slashes are
/// dropped.
#[must_use]
pub fn check_link_folder(raw: &str) -> LinkFolderCheck {
    let folder = raw.trim().trim_end_matches('/');
    if folder.is_empty()
        || folder.encode_utf16().count() > MAX_FOLDER_UTF16
        || folder.starts_with('/')
        || folder.contains(['\\', ':'])
    {
        return refused();
    }
    let parts: Vec<&str> = folder.split('/').collect();
    if parts
        .iter()
        .any(|part| matches!(*part, "" | "." | ".." | ".git"))
        || parts.first() == Some(&".weaveforge")
    {
        return refused();
    }
    LinkFolderCheck {
        ok: true,
        folder: Some(folder.to_owned()),
        reason: None,
    }
}

/// The stored links, keeping only well-formed entries: a string project id that passes
/// [`is_valid_project_id`] and a folder that passes [`check_link_folder`]. Unreadable JSON, or
/// JSON that is not an array, gives no links.
#[must_use]
pub fn parse_links(stored: &str) -> Vec<OverleafLink> {
    let Ok(Value::Array(entries)) = serde_json::from_str::<Value>(stored) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            let object = entry.as_object()?;
            let project_id = object.get("projectId")?.as_str()?;
            let folder = object.get("folder")?.as_str()?;
            if !is_valid_project_id(project_id) {
                return None;
            }
            let checked = check_link_folder(folder);
            if !checked.ok {
                return None;
            }
            Some(OverleafLink {
                project_id: project_id.to_owned(),
                folder: checked.folder.unwrap_or_default(),
            })
        })
        .collect()
}

/// The refusal every bad folder gets.
fn refused() -> LinkFolderCheck {
    LinkFolderCheck {
        ok: false,
        folder: None,
        reason: Some(BAD_FOLDER.to_owned()),
    }
}

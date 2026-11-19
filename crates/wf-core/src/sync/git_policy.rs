//! Port of `packages/core/src/workspace/parts.ts`: which workspace
//! paths may enter the git history of the workspace folder.

use serde::{Deserialize, Serialize};

use crate::sync::folder_layout::WORKSPACE_META_DIR;

/// A single file above this many bytes is skipped and reported, not committed.
pub const GIT_SYNC_MAX_FILE_BYTES: f64 = 25.0 * 1024.0 * 1024.0;

/// Folder names never synced, wherever they appear below the root. Matched
/// case-insensitively. Generic names such as `build` or `out` are not here.
pub const GIT_SYNC_IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    ".next",
    ".cache",
    "pdf-cache",
    "__pycache__",
    ".venv",
    "coverage",
];

/// File names never synced, wherever they appear. Case-insensitive.
pub const GIT_SYNC_IGNORED_FILES: &[&str] = &["desktop.ini"];

/// LaTeX build byproducts: regenerated on every compile, so never worth history.
pub const GIT_SYNC_IGNORED_EXTENSIONS: &[&str] = &[".aux", ".fdb_latexmk", ".fls", ".synctex.gz"];

/// The git exclude line for every project's mirror manifest: this machine's record of its
/// own last write, so another machine's copy must never come in with a pull.
pub const MIRROR_MANIFEST_EXCLUDE: &str = "**/.weaveforge/mirror.json";

/// Files directly in the root `.weaveforge/` folder that sync through git
/// (files-first, 0.9.4): the workspace format, settings and shared lists.
pub const SYNCED_META_FILES: &[&str] = &[
    "workspace.json",
    "settings.json",
    "tags.json",
    "fields.json",
    "quotation-types.json",
];

/// Folders in the root `.weaveforge/` folder that sync through git.
pub const SYNCED_META_DIRS: &[&str] = &["ai"];

/// The git exclude lines for the root `.weaveforge/` folder: everything stays on
/// this machine except [`SYNCED_META_FILES`] and [`SYNCED_META_DIRS`]. An
/// allowlist, so the local database, backups and tokens kept there never sync.
#[must_use]
pub fn meta_exclude_lines() -> Vec<String> {
    let mut lines = vec![format!("/{WORKSPACE_META_DIR}/*")];
    lines.extend(
        SYNCED_META_FILES
            .iter()
            .map(|name| format!("!/{WORKSPACE_META_DIR}/{name}")),
    );
    lines.extend(
        SYNCED_META_DIRS
            .iter()
            .map(|dir| format!("!/{WORKSPACE_META_DIR}/{dir}/")),
    );
    lines
}

/// The exclude line older versions wrote, which kept the whole root
/// `.weaveforge/` folder out of git; it is removed so the synced files can enter.
pub const STALE_META_EXCLUDE: &str = "/.weaveforge/";

/// True for a path inside the root `.weaveforge/` folder that stays on this
/// machine: anything not in [`SYNCED_META_FILES`] or [`SYNCED_META_DIRS`].
/// `notes/.weaveforge/...` is a project folder and is not matched.
#[must_use]
pub fn is_local_meta(rel_path: &str) -> bool {
    let segments = segments_of(rel_path);
    match segments.as_slice() {
        [meta, name] if meta.as_str() == WORKSPACE_META_DIR => {
            !SYNCED_META_FILES.contains(&name.as_str())
        }
        [meta, dir, _, ..] if meta.as_str() == WORKSPACE_META_DIR => {
            !SYNCED_META_DIRS.contains(&dir.as_str())
        }
        _ => false,
    }
}

/// Why a path is kept out of git. The string form matches the TypeScript.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum GitSyncSkipReason {
    /// Inside an ignored folder, or a `.git` entry.
    IgnoredDirectory,
    /// A file name or extension on the ignore lists.
    IgnoredFile,
    /// Size is not a finite non-negative number, or above the cap.
    TooLarge,
    /// The path has no segments (empty or `.`).
    InvalidPath,
}

/// Result of `decide_git_sync_path`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitSyncDecision {
    /// The path goes into git.
    Include,
    /// The path is kept out of git, for this reason.
    Skip(GitSyncSkipReason),
}

/// Lowercased segments of a workspace path; both slash styles, no empty or `.` parts.
fn segments_of(rel_path: &str) -> Vec<String> {
    rel_path
        .replace('\\', "/")
        .split('/')
        .map(str::to_lowercase)
        .filter(|segment| !segment.is_empty() && segment.as_str() != ".")
        .collect()
}

/// True when a path sits inside an ignored folder. The last segment is a file
/// name, so `notes/dist` is not matched but `notes/dist/x.md` is.
#[must_use]
pub fn is_under_ignored_folder(rel_path: &str) -> bool {
    // Most of the root `.weaveforge` folder is this machine's own state; `notes/.weaveforge` is not.
    if is_local_meta(rel_path) {
        return true;
    }
    let segments = segments_of(rel_path);
    segments.split_last().is_some_and(|(_, dirs)| {
        dirs.iter()
            .any(|dir| GIT_SYNC_IGNORED_DIRS.contains(&dir.as_str()))
    })
}

/// True for `<any folder>/.weaveforge/mirror.json`, a mirror manifest kept out of git.
#[must_use]
pub fn is_mirror_manifest(rel_path: &str) -> bool {
    let segments = segments_of(rel_path);
    matches!(
        segments.as_slice(),
        [.., meta, name] if meta.as_str() == WORKSPACE_META_DIR && name.as_str() == "mirror.json"
    )
}

/// Decide whether one workspace-relative path goes into git. Backslashes are
/// accepted so a Windows path matches the same rules. A size that is not a
/// finite non-negative number cannot be checked against the cap, so it is skipped.
#[must_use]
pub fn decide_git_sync_path(
    rel_path: &str,
    size_bytes: f64,
    max_file_bytes: f64,
) -> GitSyncDecision {
    let segments = segments_of(rel_path);
    let Some(file_name) = segments.last() else {
        return GitSyncDecision::Skip(GitSyncSkipReason::InvalidPath);
    };
    if is_under_ignored_folder(rel_path) || file_name.as_str() == ".git" {
        return GitSyncDecision::Skip(GitSyncSkipReason::IgnoredDirectory);
    }
    if GIT_SYNC_IGNORED_FILES.contains(&file_name.as_str())
        || is_mirror_manifest(rel_path)
        || GIT_SYNC_IGNORED_EXTENSIONS
            .iter()
            .any(|ext| file_name.ends_with(*ext))
    {
        return GitSyncDecision::Skip(GitSyncSkipReason::IgnoredFile);
    }
    if !size_bytes.is_finite() || size_bytes < 0.0 || size_bytes > max_file_bytes {
        return GitSyncDecision::Skip(GitSyncSkipReason::TooLarge);
    }
    GitSyncDecision::Include
}

/// One file's change since the last commit. Named `added` / `modified` / `deleted` in JS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileState {
    /// New file.
    Added,
    /// Existing file with new content.
    Modified,
    /// File that is gone.
    Deleted,
}

/// A commit message describing the changes, for the automatic mirror commits.
#[must_use]
pub fn describe_changes(states: &[FileState]) -> String {
    if states.is_empty() {
        return "No changes".to_owned();
    }
    let count = |want: FileState| states.iter().filter(|state| **state == want).count();
    let mut parts = Vec::new();
    let added = count(FileState::Added);
    let changed = count(FileState::Modified);
    let removed = count(FileState::Deleted);
    if added > 0 {
        parts.push(format!("{added} added"));
    }
    if changed > 0 {
        parts.push(format!("{changed} changed"));
    }
    if removed > 0 {
        parts.push(format!("{removed} removed"));
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_reason_serializes_kebab_case() {
        assert_eq!(
            serde_json::to_string(&GitSyncSkipReason::IgnoredDirectory).unwrap(),
            "\"ignored-directory\""
        );
        assert_eq!(
            serde_json::to_string(&GitSyncSkipReason::TooLarge).unwrap(),
            "\"too-large\""
        );
    }

    #[test]
    fn describe_changes_counts_in_fixed_order() {
        assert_eq!(describe_changes(&[]), "No changes");
        assert_eq!(
            describe_changes(&[
                FileState::Added,
                FileState::Modified,
                FileState::Modified,
                FileState::Deleted,
            ]),
            "1 added, 2 changed, 1 removed"
        );
        assert_eq!(describe_changes(&[FileState::Deleted]), "1 removed");
    }

    #[test]
    fn file_state_deserializes_lowercase() {
        let state: FileState = serde_json::from_str("\"modified\"").unwrap();
        assert_eq!(state, FileState::Modified);
    }
}

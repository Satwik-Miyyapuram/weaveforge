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

impl GitSyncSkipReason {
    /// The TypeScript reason string, for logs and goldens.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::IgnoredDirectory => "ignored-directory",
            Self::IgnoredFile => "ignored-file",
            Self::TooLarge => "too-large",
            Self::InvalidPath => "invalid-path",
        }
    }
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
    let segments = segments_of(rel_path);
    // The root `.weaveforge` folder is this machine's database; `notes/.weaveforge` is not.
    if segments
        .first()
        .is_some_and(|first| first.as_str() == WORKSPACE_META_DIR)
    {
        return true;
    }
    segments.split_last().is_some_and(|(_, dirs)| {
        dirs.iter()
            .any(|dir| GIT_SYNC_IGNORED_DIRS.contains(&dir.as_str()))
    })
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

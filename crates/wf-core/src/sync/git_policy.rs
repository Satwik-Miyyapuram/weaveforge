//! Port of `packages/core/src/workspace/git-sync-policy.ts`: which workspace
//! paths may enter the git history of the workspace folder.

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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

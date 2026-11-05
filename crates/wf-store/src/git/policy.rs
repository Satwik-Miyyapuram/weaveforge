//! Which workspace paths may enter folder history, and whether a folder may be committed to.
//!
//! Ported from `packages/core/src/workspace/git-sync-policy.ts`, `git-gate.ts` and
//! `describeChanges` in `git-port.ts`; the TypeScript stays the reference until the port lands.

use wf_core::workspace::WORKSPACE_META_DIR;

/// Largest file folder history takes; bigger files are skipped and reported.
pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;

/// Folder names never synced, wherever they appear below the root. Matched case-insensitively.
pub const IGNORED_DIRS: [&str; 9] = [
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
pub const IGNORED_FILES: [&str; 1] = ["desktop.ini"];

/// LaTeX build byproducts, regenerated on every compile.
pub const IGNORED_EXTENSIONS: [&str; 4] = [".aux", ".fdb_latexmk", ".fls", ".synctex.gz"];

/// Why a path is kept out of folder history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// Inside an ignored folder, or a `.git` entry.
    IgnoredDirectory,
    /// A file name or extension that is never synced.
    IgnoredFile,
    /// Over the size cap, or a size that cannot be checked.
    TooLarge,
    /// Empty, or names no file or folder.
    InvalidPath,
}

/// Lowercased segments with both slash styles accepted; empty and `.` parts dropped.
fn segments_of(rel_path: &str) -> Vec<String> {
    rel_path
        .replace('\\', "/")
        .split('/')
        .map(str::to_lowercase)
        .filter(|segment| !segment.is_empty() && segment.as_str() != ".")
        .collect()
}

/// True when a path sits below an ignored folder.
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
    match segments.split_last() {
        Some((_, folders)) => folders
            .iter()
            .any(|segment| IGNORED_DIRS.contains(&segment.as_str())),
        None => false,
    }
}

/// Whether one workspace path goes into folder history. `size` of `None` is unknown and skipped.
///
/// # Errors
/// The reason the path is kept out.
pub fn decide_path(
    rel_path: &str,
    size: Option<u64>,
    max_file_bytes: u64,
) -> Result<(), SkipReason> {
    let segments = segments_of(rel_path);
    let Some(file_name) = segments.last() else {
        return Err(SkipReason::InvalidPath);
    };
    // A `.git` entry is a folder or a pointer file, so it is refused either way.
    if is_under_ignored_folder(rel_path) || file_name.as_str() == ".git" {
        return Err(SkipReason::IgnoredDirectory);
    }
    if IGNORED_FILES.contains(&file_name.as_str())
        || IGNORED_EXTENSIONS
            .iter()
            .any(|ext| file_name.ends_with(*ext))
    {
        return Err(SkipReason::IgnoredFile);
    }
    match size {
        Some(bytes) if bytes <= max_file_bytes => Ok(()),
        _ => Err(SkipReason::TooLarge),
    }
}

/// Whether the folder is its own repository, sits in none, or sits inside someone else's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepoState {
    /// No repository at or above the folder.
    None,
    /// The folder is itself the repository root.
    Own,
    /// The folder sits inside a repository rooted at `root`.
    Enclosing {
        /// The root of the repository the folder sits in.
        root: String,
    },
}

/// What a permitted commit does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitAction {
    /// Create a repository in the folder first.
    Init,
    /// Commit to the folder's own repository.
    Commit,
}

/// Refusal text when folder history is switched off.
pub const GIT_OFF: &str = "Folder history is switched off.";

/// Whether a commit may run.
///
/// # Errors
/// The text to show the reader when the commit is refused.
pub fn decide_commit(enabled: bool, state: &RepoState) -> Result<CommitAction, String> {
    if !enabled {
        return Err(GIT_OFF.to_owned());
    }
    match state {
        RepoState::Own => Ok(CommitAction::Commit),
        RepoState::None => Ok(CommitAction::Init),
        // Not offered as something to override: enabling means "keep my folder's history".
        RepoState::Enclosing { root } => Err(format!(
            "This folder is inside the repository at {root}, so WeaveForge will not commit here."
        )),
    }
}

/// One file's change since the last commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

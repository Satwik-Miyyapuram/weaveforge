//! Filesystem port for the workspace folder. Ports `packages/core/src/workspace/fs-port.ts`.
//!
//! Nine methods, deliberately small: no symlinks, modes, streams or watching. Paths are POSIX
//! and relative to a root the adapter owns; adapters reject unsafe paths.

use crate::workspace::UnsafePath;

/// File or folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FsKind {
    /// A regular file.
    File,
    /// A folder.
    Dir,
}

/// One entry. `modified_ms` is milliseconds since the Unix epoch (the TS keeps an ISO string;
/// nothing reads it but tests).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceStat {
    /// Normalized relative POSIX path.
    pub path: String,
    /// Byte length; `0` for folders.
    pub size: u64,
    /// Last write, in milliseconds since the Unix epoch.
    pub modified_ms: u64,
    /// File or folder.
    pub kind: FsKind,
}

/// Why a filesystem call failed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FsError {
    /// Path refused by `safe_workspace_path`.
    Unsafe(UnsafePath),
    /// Missing path, carried as given.
    NotFound(String),
    /// Adapter-specific message.
    Io(String),
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsafe(path) => write!(f, "{path}"),
            Self::NotFound(path) => write!(f, "ENOENT: {path}"),
            Self::Io(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for FsError {}

impl From<UnsafePath> for FsError {
    fn from(err: UnsafePath) -> Self {
        Self::Unsafe(err)
    }
}

/// Filesystem adapter for one workspace folder.
pub trait WorkspaceFs {
    /// Raw bytes of a file.
    ///
    /// # Errors
    /// `Unsafe` for a refused path, `NotFound` when missing.
    fn read_file(&self, path: &str) -> Result<Vec<u8>, FsError>;

    /// UTF-8, leading BOM dropped, invalid bytes become U+FFFD (as TextDecoder).
    ///
    /// # Errors
    /// Same as [`WorkspaceFs::read_file`].
    fn read_text(&self, path: &str) -> Result<String, FsError>;

    /// Create or replace a file, creating parent folders.
    ///
    /// # Errors
    /// `Unsafe` for a refused path.
    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), FsError>;

    /// Delete a file, or a whole subtree when `recursive`. Missing paths are not an error.
    ///
    /// # Errors
    /// `Unsafe` for a refused path.
    fn remove(&mut self, path: &str, recursive: bool) -> Result<(), FsError>;

    /// Create a folder and every missing parent.
    ///
    /// # Errors
    /// `Unsafe` for a refused path.
    fn mkdirp(&mut self, path: &str) -> Result<(), FsError>;

    /// One level.
    ///
    /// # Errors
    /// `Unsafe` for a refused path.
    fn list(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError>;

    /// Recursive, files only.
    ///
    /// # Errors
    /// `Unsafe` for a refused path.
    fn walk(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError>;

    /// `None` when missing or unreadable.
    fn stat(&self, path: &str) -> Option<WorkspaceStat>;

    /// Move a file, replacing its time and parents at the target.
    ///
    /// # Errors
    /// `Unsafe` for a refused path, `NotFound` when the source is missing.
    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError>;
}

/// Every file under `dir`, depth-first in `list` order (TS walkByList).
///
/// # Errors
/// Propagates `list` errors.
pub fn walk_by_list<F: WorkspaceFs + ?Sized>(
    fs: &F,
    dir: &str,
) -> Result<Vec<WorkspaceStat>, FsError> {
    let mut out = Vec::new();
    collect_files(fs, dir, &mut out)?;
    Ok(out)
}

fn collect_files<F: WorkspaceFs + ?Sized>(
    fs: &F,
    dir: &str,
    out: &mut Vec<WorkspaceStat>,
) -> Result<(), FsError> {
    for entry in fs.list(dir)? {
        match entry.kind {
            FsKind::File => out.push(entry),
            FsKind::Dir => collect_files(fs, &entry.path, out)?,
        }
    }
    Ok(())
}

/// UTF-8 decode as TextDecoder does: strip one leading EF BB BF, then from_utf8_lossy.
#[must_use]
pub fn decode_text(bytes: &[u8]) -> String {
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    String::from_utf8_lossy(body).into_owned()
}

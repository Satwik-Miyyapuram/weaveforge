//! The folder mirror's filesystem port, backed by [`Vault`].

use std::io::ErrorKind;
use std::time::UNIX_EPOCH;

use wf_core::sync::workspace_fs::{FsError, FsKind, WorkspaceFs, WorkspaceStat};
use wf_core::workspace::UnsafePath;

use crate::vault::{Entry, EntryKind, Vault, VaultError};

/// Converts a vault entry to the port's stat, with the modified time in epoch milliseconds.
fn to_stat(entry: Entry) -> WorkspaceStat {
    let modified_ms = entry
        .modified
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
    let kind = match entry.kind {
        EntryKind::File => FsKind::File,
        EntryKind::Dir => FsKind::Dir,
    };
    WorkspaceStat {
        path: entry.path,
        size: entry.size,
        modified_ms,
        kind,
    }
}

/// Maps a vault failure to the port's error; `path` is the path the call was made on.
fn to_fs_error(path: &str, err: VaultError) -> FsError {
    match err {
        VaultError::UnsafePath(text) => FsError::Unsafe(UnsafePath(text)),
        other if other.io_kind() == Some(ErrorKind::NotFound) => FsError::NotFound(path.to_owned()),
        other => FsError::Io(other.to_string()),
    }
}

impl WorkspaceFs for Vault {
    /// The raw bytes of a file.
    fn read_file(&self, path: &str) -> Result<Vec<u8>, FsError> {
        Vault::read_file(self, path).map_err(|err| to_fs_error(path, err))
    }

    /// A file decoded as UTF-8 without a byte order mark.
    fn read_text(&self, path: &str) -> Result<String, FsError> {
        Vault::read_text(self, path).map_err(|err| to_fs_error(path, err))
    }

    /// Replace a file's bytes atomically, creating parent folders.
    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), FsError> {
        Vault::write_file(self, path, data).map_err(|err| to_fs_error(path, err))
    }

    /// Remove a file, or a folder when `recursive`. A missing path is `Ok`: `Vault::remove`
    /// already treats it as removed, which matches the TS memory fs.
    fn remove(&mut self, path: &str, recursive: bool) -> Result<(), FsError> {
        Vault::remove(self, path, recursive).map_err(|err| to_fs_error(path, err))
    }

    /// Create a folder and any missing parents.
    fn mkdirp(&mut self, path: &str) -> Result<(), FsError> {
        Vault::mkdirp(self, path).map_err(|err| to_fs_error(path, err))
    }

    /// The direct children of a folder; `""` is the root and temp files are left out.
    fn list(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        Vault::list(self, dir)
            .map(|entries| entries.into_iter().map(to_stat).collect())
            .map_err(|err| to_fs_error(dir, err))
    }

    /// Every file under a folder; `""` is the root and temp files are left out.
    fn walk(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        Vault::walk(self, dir)
            .map(|entries| entries.into_iter().map(to_stat).collect())
            .map_err(|err| to_fs_error(dir, err))
    }

    /// Metadata for one path; any failure is `None`.
    fn stat(&self, path: &str) -> Option<WorkspaceStat> {
        Vault::stat(self, path).map(to_stat)
    }

    /// Move a file, creating its parent folders and replacing any file at `to`.
    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError> {
        Vault::rename(self, from, to).map_err(|err| to_fs_error(from, err))
    }
}

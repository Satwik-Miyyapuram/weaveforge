//! Choosing the folder a workspace lives in, and telling our own folder from a stranger's.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use wf_core::workspace::WORKSPACE_META_DIR;

/// The folder WeaveForge makes inside a folder that is already somebody's.
///
/// Choosing a folder with a person's own files in it (`Documents`) is ordinary,
/// so the workspace nests here rather than refusing; their files are never mixed
/// with ours.
pub const WORKSPACE_SUBDIR: &str = "WeaveForge";

/// Whether a verified folder is brand new or already holds a workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootState {
    /// No meaningful files; safe to start a workspace here.
    Empty,
    /// Carries the `.weaveforge` mark; a workspace we already wrote.
    Existing,
}

/// Why a folder cannot hold a workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum RootError {
    /// Missing, unreadable, or a file rather than a folder.
    #[error("That is not a folder.")]
    NotAFolder,
    /// Has the user's own files and no `.weaveforge` mark.
    #[error(
        "That folder already has files in it. Pick an empty folder, or one WeaveForge already writes to."
    )]
    NotEmpty,
    /// The nested `WeaveForge/` could not be created.
    #[error("WeaveForge could not write inside that folder.")]
    CannotWrite,
}

/// A chosen folder, and where the workspace in it actually lives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootChoice {
    /// The folder the workspace is in (the chosen one, or its `WeaveForge/`).
    pub root: PathBuf,
    /// Whether that folder is new or already ours.
    pub state: RootState,
}

/// Decide whether a directory may become the workspace folder.
///
/// Strict on purpose: a folder with a person's files and no mark is refused, so
/// a remembered folder that is no longer ours is never adopted. The mark
/// (`.weaveforge/`) is what identifies our own; dot-files do not count as files.
pub fn verify_root(root: &Path) -> Result<RootState, RootError> {
    let meta = fs::metadata(root).map_err(|_| RootError::NotAFolder)?;
    if !meta.is_dir() {
        return Err(RootError::NotAFolder);
    }
    let entries = fs::read_dir(root).map_err(|_| RootError::NotAFolder)?;
    let mut marked = false;
    let mut meaningful = false;
    for entry in entries {
        let name = entry.map_err(|_| RootError::NotAFolder)?.file_name();
        marked |= name.as_os_str() == OsStr::new(WORKSPACE_META_DIR);
        meaningful |= !name.to_string_lossy().starts_with('.');
    }
    if marked {
        Ok(RootState::Existing)
    } else if meaningful {
        Err(RootError::NotEmpty)
    } else {
        Ok(RootState::Empty)
    }
}

/// Where a chosen folder's workspace should live.
///
/// Unlike [`verify_root`], a *choice* places the workspace somewhere sensible: a
/// folder with someone's files gets a `WeaveForge/` inside it, and the result says where.
pub fn workspace_root_for(chosen: &Path) -> Result<RootChoice, RootError> {
    match verify_root(chosen) {
        Ok(state) => {
            ensure_writable(chosen)?;
            Ok(RootChoice {
                root: chosen.to_path_buf(),
                state,
            })
        }
        Err(RootError::NotEmpty) => nest(chosen),
        Err(refusal) => Err(refusal),
    }
}

fn nest(chosen: &Path) -> Result<RootChoice, RootError> {
    let nested = chosen.join(WORKSPACE_SUBDIR);
    fs::create_dir_all(&nested).map_err(|_| RootError::CannotWrite)?;
    let state = verify_root(&nested)?;
    ensure_writable(&nested)?;
    Ok(RootChoice {
        root: nested,
        state,
    })
}

/// Proves the folder takes a file, so a read-only folder is refused when it is chosen rather
/// than on the first save. The probe is removed again; a dot-file never counts as a person's file.
fn ensure_writable(root: &Path) -> Result<(), RootError> {
    ensure_writable_with(root, |probe| fs::remove_file(probe))
}

/// `ensure_writable` with the cleanup step given. The write is what proves the folder takes a file;
/// a probe that writes but will not be removed still proves that, so only a warning is logged.
fn ensure_writable_with(
    root: &Path,
    remove: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<(), RootError> {
    let probe = root.join(format!(".weaveforge-write-probe-{}", std::process::id()));
    fs::write(&probe, b"").map_err(|_| RootError::CannotWrite)?;
    if let Err(error) = remove(&probe) {
        eprintln!("[workspace] could not remove the write probe {}: {error}", probe.display());
    }
    Ok(())
}

#[cfg(test)]
mod probe_tests {
    use super::*;

    #[test]
    fn a_probe_that_writes_but_will_not_be_removed_still_means_writable() {
        let dir = std::env::temp_dir().join(format!("wf-probe-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let result = ensure_writable_with(&dir, |_| Err(std::io::Error::other("busy")));
        let leftover = fs::read_dir(&dir).unwrap().count();
        // Clean up what the test made: the probe the stub left behind, then the folder.
        for entry in fs::read_dir(&dir).unwrap().flatten() {
            let _ = fs::remove_file(entry.path());
        }
        let _ = fs::remove_dir(&dir);
        assert_eq!(result, Ok(()));
        assert_eq!(leftover, 1);
    }
}

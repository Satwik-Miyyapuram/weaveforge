//! The workspace folder the shell holds for the page: chosen, remembered, and confined.

use std::fmt::Display;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use wf_store::root::{RootState, verify_root, workspace_root_for};
use wf_store::vault::{Entry, EntryKind, TEMP_SUFFIX, Vault, VaultError, WALK_DEPTH_MAX};

/// The most text that crosses the bridge in one read or write, in bytes.
pub const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;
/// The most bytes (PDFs) that cross the bridge in one read or write.
pub const MAX_BLOB_BYTES: u64 = 80 * 1024 * 1024;
/// Said when no workspace folder has been chosen yet.
pub const NO_ROOT: &str = "No workspace folder is chosen yet.";
/// Said when a path is refused for something other than its reason.
pub const BAD_ARGUMENT: &str = "That is not a path this folder can hold.";

/// A temp file this old was left by a write that never finished, not one in progress.
pub const SWEEP_AGE: Duration = Duration::from_secs(300);

/// "That file is too large to open here (over 8 MB)." — cap shown in whole MiB.
#[must_use]
pub fn too_large(cap_bytes: u64) -> String {
    let mib = cap_bytes / (1024 * 1024);
    format!("That file is too large to open here (over {mib} MB).")
}

/// Millisecond ISO-8601 UTC, exactly like JS `Date.prototype.toISOString`: "2026-10-30T12:34:56.789Z".
#[must_use]
pub fn iso_utc(time: SystemTime) -> String {
    let millis = time.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let millis = i64::try_from(millis).unwrap_or(i64::MAX);
    let secs = millis / 1000;
    let ms = millis % 1000;
    let (year, month, day) = civil_from_days(secs / 86_400);
    let day_secs = secs % 86_400;
    let (hour, minute, second) = (day_secs / 3600, day_secs % 3600 / 60, day_secs % 60);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{ms:03}Z")
}

/// Proleptic Gregorian date for a count of days since 1970-01-01 (Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Whether a chosen root is brand new or already holds a workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RootKind {
    /// No meaningful files; safe to start a workspace here.
    Empty,
    /// Already a workspace we wrote.
    Existing,
}

/// The chosen workspace folder as the page sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultRoot {
    /// Absolute path of the workspace folder.
    pub path: String,
    /// Whether that folder is new or already ours.
    pub state: RootKind,
}

/// Whether a listed entry is a file or a folder, as the page sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum EntryKindPayload {
    /// A regular file.
    File,
    /// A folder.
    Dir,
}

/// One file or folder inside the workspace, as the page sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    /// Path relative to the workspace root, `/`-separated.
    pub path: String,
    /// File or folder.
    pub kind: EntryKindPayload,
    /// Size in bytes.
    #[specta(type = f64)]
    pub size: u64,
    /// Last modification time, ISO-8601 UTC.
    pub modified_at: String,
}

/// The session the commands share. Clones share one session.
#[derive(Clone, Default)]
pub struct VaultState(Arc<Mutex<VaultSession>>);

impl VaultState {
    /// A shared session with no folder chosen.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The session, recovered if a holder panicked (its state is a path, never half-written).
    pub fn lock(&self) -> MutexGuard<'_, VaultSession> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The chosen workspace folder, held by the shell; the page never names its own root.
#[derive(Default)]
pub struct VaultSession {
    current: Option<(VaultRoot, Vault)>,
}

impl VaultSession {
    /// A session with no folder chosen.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The chosen folder, if any.
    #[must_use]
    pub fn root(&self) -> Option<VaultRoot> {
        self.current.as_ref().map(|(root, _)| root.clone())
    }

    /// Folder from the dialog. `None` (cancelled) → Ok(current root), unchanged.
    ///
    /// # Errors
    /// The reader-facing reason the folder cannot hold a workspace.
    pub fn choose(&mut self, chosen: Option<&Path>) -> Result<Option<VaultRoot>, String> {
        let Some(path) = chosen else {
            return Ok(self.root());
        };
        let choice = workspace_root_for(path).map_err(|e| message(&e))?;
        Ok(Some(self.install(choice.root, choice.state)))
    }

    /// Remembered folder. Same, but with `verify_root` (adopts exactly that path).
    ///
    /// # Errors
    /// The reader-facing reason the folder cannot hold a workspace.
    pub fn adopt(&mut self, chosen: Option<&Path>) -> Result<Option<VaultRoot>, String> {
        let Some(path) = chosen else {
            return Ok(self.root());
        };
        let state = verify_root(path).map_err(|e| message(&e))?;
        Ok(Some(self.install(path.to_path_buf(), state)))
    }

    /// Previous run's folder. None or "" → None. A failed adopt → None and the session is left unchanged; the caller then clears the remembered folder.
    #[must_use]
    pub fn restore(&mut self, remembered: Option<&str>) -> Option<VaultRoot> {
        let path = remembered.filter(|p| !p.is_empty())?;
        self.adopt(Some(Path::new(path))).ok().flatten()
    }

    /// Drops the chosen folder; every operation then answers `NO_ROOT` until one is chosen again.
    pub fn forget(&mut self) {
        self.current = None;
    }

    /// Text over `MAX_TEXT_BYTES` → Err(too_large). Missing → Ok(None).
    ///
    /// # Errors
    /// No root, a refused path, or a file over the cap.
    pub fn read_text(&self, rel: &str) -> Result<Option<String>, String> {
        let vault = self.vault()?;
        check_cap(vault, rel, MAX_TEXT_BYTES)?;
        absent_is_none(vault.read_text_max(rel, MAX_TEXT_BYTES))
    }

    /// Same as `read_text` with `MAX_BLOB_BYTES`.
    ///
    /// # Errors
    /// No root, a refused path, or a file over the cap.
    pub fn read_bytes(&self, rel: &str) -> Result<Option<Vec<u8>>, String> {
        let vault = self.vault()?;
        check_cap(vault, rel, MAX_BLOB_BYTES)?;
        absent_is_none(vault.read_file_max(rel, MAX_BLOB_BYTES))
    }

    /// Utf-8 length over `MAX_TEXT_BYTES` → Err(too_large), and nothing is written.
    ///
    /// # Errors
    /// No root, a refused path, or contents over the cap.
    pub fn write_text(&self, rel: &str, contents: &str) -> Result<(), String> {
        let vault = self.vault()?;
        check_size(contents.len(), MAX_TEXT_BYTES)?;
        vault
            .write_file(rel, contents.as_bytes())
            .map_err(|e| message(&e))
    }

    /// Same as `write_text` with `MAX_BLOB_BYTES`.
    ///
    /// # Errors
    /// No root, a refused path, or contents over the cap.
    pub fn write_bytes(&self, rel: &str, bytes: &[u8]) -> Result<(), String> {
        let vault = self.vault()?;
        check_size(bytes.len(), MAX_BLOB_BYTES)?;
        vault.write_file(rel, bytes).map_err(|e| message(&e))
    }

    /// `None` = the root folder.
    ///
    /// # Errors
    /// No root, a refused path, or a folder that cannot be read.
    pub fn list(&self, dir: Option<&str>) -> Result<Vec<VaultEntry>, String> {
        let vault = self.vault()?;
        let entries = vault.list(dir.unwrap_or("")).map_err(|e| message(&e))?;
        Ok(entries.into_iter().map(entry_payload).collect())
    }

    /// Metadata for one path; `None` when it is missing.
    ///
    /// # Errors
    /// No root.
    pub fn stat(&self, rel: &str) -> Result<Option<VaultEntry>, String> {
        Ok(self.vault()?.stat(rel).map(entry_payload))
    }

    /// Not recursive. A missing file succeeds, as with TS `force: true`.
    ///
    /// # Errors
    /// No root, a refused path, or a folder (never removed recursively).
    pub fn remove(&self, rel: &str) -> Result<(), String> {
        self.vault()?.remove(rel, false).map_err(|e| message(&e))
    }

    /// Makes `path` the root and sweeps its stale temp files.
    fn install(&mut self, path: PathBuf, state: RootState) -> VaultRoot {
        let root = VaultRoot {
            path: path.to_string_lossy().into_owned(),
            state: match state {
                RootState::Empty => RootKind::Empty,
                RootState::Existing => RootKind::Existing,
            },
        };
        let _ = sweep_temp_files(&path, SWEEP_AGE);
        self.current = Some((root.clone(), Vault::new(path)));
        root
    }

    fn vault(&self) -> Result<&Vault, String> {
        self.current
            .as_ref()
            .map(|(_, vault)| vault)
            .ok_or_else(|| NO_ROOT.to_owned())
    }
}

/// Deletes `*.wftmp` files (TEMP_SUFFIX) left by an interrupted atomic write,
/// anywhere under `root` down to WALK_DEPTH_MAX folders. Only files last modified more than
/// `older_than` ago are deleted (a live write elsewhere is left alone). Symlinked folders are not
/// followed, and other files are never touched. Best effort: errors are skipped. Returns how many were removed.
#[must_use]
pub fn sweep_temp_files(root: &Path, older_than: Duration) -> usize {
    let Some(cutoff) = SystemTime::now().checked_sub(older_than) else {
        return 0;
    };
    let mut removed = 0;
    let mut folders = vec![(root.to_path_buf(), 0_usize)];
    while let Some((dir, depth)) = folders.pop() {
        let Ok(children) = fs::read_dir(&dir) else {
            continue;
        };
        for child in children.flatten() {
            // `file_type` does not follow links, so a linked folder is never entered.
            let Ok(kind) = child.file_type() else {
                continue;
            };
            if kind.is_dir() {
                if depth < WALK_DEPTH_MAX {
                    folders.push((child.path(), depth + 1));
                }
            } else if kind.is_file()
                && is_temp_name(&child.file_name())
                && is_stale(&child, cutoff)
                && fs::remove_file(child.path()).is_ok()
            {
                removed += 1;
            }
        }
    }
    removed
}

fn is_temp_name(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|n| n.ends_with(TEMP_SUFFIX))
}

fn is_stale(entry: &fs::DirEntry, cutoff: SystemTime) -> bool {
    entry
        .metadata()
        .ok()
        .and_then(|meta| meta.modified().ok())
        .is_some_and(|modified| modified < cutoff)
}

fn entry_payload(entry: Entry) -> VaultEntry {
    VaultEntry {
        path: entry.path,
        kind: match entry.kind {
            EntryKind::File => EntryKindPayload::File,
            EntryKind::Dir => EntryKindPayload::Dir,
        },
        size: entry.size,
        modified_at: iso_utc(entry.modified),
    }
}

/// The reader-facing text of an error; a blank message becomes the generic refusal.
fn message(err: &impl Display) -> String {
    let text = err.to_string();
    if text.is_empty() {
        BAD_ARGUMENT.to_owned()
    } else {
        text
    }
}

/// A file missing from the folder is `None`, not a failure: callers ask about files that may not exist yet.
fn absent_is_none<T>(result: Result<T, VaultError>) -> Result<Option<T>, String> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(err) if err.io_kind() == Some(io::ErrorKind::NotFound) => Ok(None),
        Err(VaultError::TooLarge { max, .. }) => Err(too_large(max)),
        Err(err) => Err(message(&err)),
    }
}

/// Refuses a file over `cap` by its size on disk, before any of it is read.
fn check_cap(vault: &Vault, rel: &str, cap: u64) -> Result<(), String> {
    match vault.stat(rel) {
        Some(entry) if entry.size > cap => Err(too_large(cap)),
        _ => Ok(()),
    }
}

/// Refuses contents over `cap` bytes before anything is written.
fn check_size(len: usize, cap: u64) -> Result<(), String> {
    match u64::try_from(len) {
        Ok(size) if size <= cap => Ok(()),
        _ => Err(too_large(cap)),
    }
}

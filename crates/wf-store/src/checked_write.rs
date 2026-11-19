//! The checked write every user file goes through.
//!
//! A write first compares the file on disk with the hash the caller last saw. If they differ,
//! nothing is touched and the caller gets the disk hash back. Otherwise the new bytes go to a
//! temp file beside the target, are fsynced, and renamed over it. The replaced bytes are kept
//! as a `.wfprev` sibling until the write is confirmed; if another process changed the file in
//! the meantime, those bytes move to a conflict copy so nothing is lost. Deletes go to the
//! workspace trash and renames never overwrite a file.
//!
//! A create-only write (expected `Some("")` on a missing file) is linked into place with
//! `hard_link`, which fails if the file appeared since the check, so it never replaces anything.
//!
//! Known window: a replace write runs `make_prev` and then the rename as two steps. A file another
//! process writes between those two steps is replaced by the rename, and its bytes are not kept
//! (`.wfprev` only holds what was on disk before the write). Closing it needs a no-replace swap
//! (renameat2 / MoveFileExW), which is not implemented.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use wf_core::sync::folder_layout::{
    compact_stamp, conflict_copy_path, day_stamp, numbered_path, trash_path,
};
use wf_core::sync::frontmatter::{bytes_digest, canonical_digest, canonical_text};
use wf_core::sync::text_merge::{TextMerge, merge_text};

use crate::vault::{Vault, VaultError, WALK_DEPTH_MAX, io_err, is_generated_temp, temp_beside};

/// Marks the replaced bytes kept beside a file while a checked write is confirmed.
pub const PREV_SUFFIX: &str = ".wfprev";

/// How many numbered names are tried before giving up on finding a free one.
const FREE_NAME_TRIES: u32 = 1000;

/// How many times a merging write re-reads the disk when the file keeps changing under it.
const MERGE_TRIES: u32 = 5;

/// What a checked write did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    /// The new bytes are on disk.
    Written {
        /// Digest of the file as it is on disk after the write.
        hash: String,
    },
    /// The file no longer matched the expected hash, so nothing was written.
    Changed {
        /// Digest of the file on disk now; empty when the file is missing.
        disk_hash: String,
    },
}

/// What a merging write did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeWrite {
    /// The edits merged cleanly and the merged text is on disk.
    Merged {
        /// Digest of the merged file on disk.
        hash: String,
    },
    /// The edits clashed; the app's text is on disk and the disk text was kept as a copy.
    Conflict {
        /// Digest of the app's text now on disk.
        hash: String,
        /// Relative path of the copy holding the disk text.
        conflict_copy: String,
    },
}

impl Vault {
    /// Write text to a file if it still matches `expected` (`None` writes unconditionally).
    ///
    /// The text is stored in canonical form (NFC, LF line endings).
    ///
    /// # Errors
    /// Refused paths, escapes, or any filesystem failure.
    pub fn write_text_checked(
        &self,
        rel: &str,
        text: &str,
        expected: Option<&str>,
    ) -> Result<WriteOutcome, VaultError> {
        let data = canonical_text(text);
        self.write_checked_with_hook(rel, data.as_bytes(), true, expected, &mut || {})
    }

    /// Write bytes to a file if it still matches `expected` (`None` writes unconditionally).
    ///
    /// # Errors
    /// Refused paths, escapes, or any filesystem failure.
    pub fn write_bytes_checked(
        &self,
        rel: &str,
        bytes: &[u8],
        expected: Option<&str>,
    ) -> Result<WriteOutcome, VaultError> {
        self.write_checked_with_hook(rel, bytes, false, expected, &mut || {})
    }

    /// [`Vault::write_text_checked`] and [`Vault::write_bytes_checked`] with a hook that runs
    /// after the temp file is written and before it is swapped in; tests use it to simulate
    /// another process editing the file in that window.
    ///
    /// # Errors
    /// Refused paths, escapes, or any filesystem failure.
    #[doc(hidden)]
    pub fn write_checked_with_hook(
        &self,
        rel: &str,
        data: &[u8],
        text: bool,
        expected: Option<&str>,
        before_swap: &mut dyn FnMut(),
    ) -> Result<WriteOutcome, VaultError> {
        let target = self.resolve(rel)?;
        let disk = read_disk(&target, rel)?;
        if let Some(outcome) = check_expected(disk.as_deref(), text, expected) {
            return Ok(outcome);
        }
        let disk_hash = disk.as_deref().map(|bytes| hash_of(bytes, text));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|source| io_err("create folder", rel, source))?;
        }
        let temp = temp_beside(&target);
        if let Err(source) = write_temp(&temp, data) {
            let _ = fs::remove_file(&temp);
            return Err(io_err("write", rel, source));
        }
        before_swap();
        if disk.is_none() && expected == Some("") {
            match fs::hard_link(&temp, &target) {
                Ok(()) => {
                    let _ = fs::remove_file(&temp);
                    return written(&target, rel, text);
                }
                Err(source) if source.kind() == io::ErrorKind::AlreadyExists => {
                    let _ = fs::remove_file(&temp);
                    let now = read_disk(&target, rel)?;
                    return Ok(WriteOutcome::Changed {
                        disk_hash: now.map(|bytes| hash_of(&bytes, text)).unwrap_or_default(),
                    });
                }
                // Any other link error (no hard-link support, a cross-device or permission
                // failure) falls back to the replace path, which still checks first and keeps
                // the window described in the module doc.
                Err(_) => {}
            }
        }
        // Known window (module doc): a write by another process between `make_prev` and the
        // rename is replaced by the rename and its bytes are not kept.
        let prev = match make_prev(&target) {
            Ok(prev) => prev,
            Err(source) => {
                let _ = fs::remove_file(&temp);
                return Err(io_err("write", rel, source));
            }
        };
        if let Err(source) = fs::rename(&temp, &target) {
            let _ = fs::remove_file(&temp);
            if let Some(prev) = &prev {
                let _ = fs::remove_file(prev);
            }
            return Err(io_err("rename", rel, source));
        }
        if let Some(prev) = prev {
            let displaced = match expected {
                Some(expected) => expected.to_owned(),
                None => disk_hash.unwrap_or_default(),
            };
            // The new bytes are already in place, so a settle failure must not report the write
            // as failed. The replaced bytes stay in `prev`, which is never deleted by a sweep.
            let _ = self.settle_prev(rel, &prev, &displaced, text);
        }
        written(&target, rel, text)
    }

    /// Move a file into the workspace trash; returns the trashed path, relative to the root.
    ///
    /// # Errors
    /// Refused paths, escapes, a missing file, or a failed move.
    pub fn delete_to_trash(&self, rel: &str) -> Result<String, VaultError> {
        let target = self.resolve(rel)?;
        if !target.exists() {
            return Err(io_err(
                "delete",
                rel,
                io::Error::from(io::ErrorKind::NotFound),
            ));
        }
        let base = trash_path(rel, &day_stamp(now_ms()));
        let dest_rel = self.free_path(&base)?;
        let dest = self.resolve(&dest_rel)?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|source| io_err("create folder", rel, source))?;
        }
        fs::rename(&target, &dest).map_err(|source| io_err("delete", rel, source))?;
        Ok(dest_rel)
    }

    /// Move a file to a new path without overwriting: a different file already at `to` is
    /// first moved to a conflict copy. Returns that copy's path, if one was made.
    ///
    /// # Errors
    /// Refused or escaping paths, a missing source, or a failed move.
    pub fn rename_checked(&self, from: &str, to: &str) -> Result<Option<String>, VaultError> {
        let src = self.resolve(from)?;
        let dest = self.resolve(to)?;
        let src_real = fs::canonicalize(&src).map_err(|source| io_err("rename", from, source))?;
        let mut aside_rel = None;
        if is_other_file(&src_real, &dest) {
            let aside = self.free_path(&conflict_copy_path(to, &compact_stamp(now_ms())))?;
            let aside_path = self.resolve(&aside)?;
            fs::rename(&dest, &aside_path).map_err(|source| io_err("rename", to, source))?;
            aside_rel = Some(aside);
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|source| io_err("create folder", to, source))?;
        }
        fs::rename(&src, &dest).map_err(|source| io_err("rename", from, source))?;
        Ok(aside_rel)
    }

    /// Remove leftover generated temp files older than `older_than`; returns how many. Kept
    /// `.wfprev` files are not touched.
    ///
    /// # Errors
    /// Currently never; unreadable entries are skipped.
    pub fn sweep_stale_temps(&self, older_than: Duration) -> Result<usize, VaultError> {
        let cutoff = SystemTime::now()
            .checked_sub(older_than)
            .unwrap_or(UNIX_EPOCH);
        let mut removed = 0;
        sweep_dir(self.root(), 0, cutoff, &mut removed);
        Ok(removed)
    }

    /// Write `mine` over a file that may have changed since `base`, merging the two edits.
    ///
    /// A clean merge is written as the merged text. A clash keeps `mine` in the file and the
    /// disk text in a conflict copy.
    ///
    /// # Errors
    /// Refused paths, escapes, or any filesystem failure.
    pub fn write_text_merging(
        &self,
        rel: &str,
        base: &str,
        mine: &str,
    ) -> Result<MergeWrite, VaultError> {
        self.write_text_merging_with_hook(rel, base, mine, &mut || {})
    }

    /// [`Vault::write_text_merging`] with a hook that runs after each merge and before its
    /// checked write, so tests can change the file mid-merge.
    #[doc(hidden)]
    pub fn write_text_merging_with_hook(
        &self,
        rel: &str,
        base: &str,
        mine: &str,
        before_write: &mut dyn FnMut(),
    ) -> Result<MergeWrite, VaultError> {
        let target = self.resolve(rel)?;
        // Each attempt reads the disk, merges, and writes only if the file still has the hash
        // that was merged from. A write that loses that race starts over with the newer disk text.
        for _ in 0..MERGE_TRIES {
            let raw = read_disk(&target, rel)?;
            // A missing file is expected to stay missing, so a file created in the meantime
            // is seen as a change and the loop merges against it instead of overwriting it.
            let expected = raw
                .as_deref()
                .map_or_else(String::new, |bytes| hash_of(bytes, true));
            let disk_bytes = raw.unwrap_or_else(|| base.as_bytes().to_vec());
            let clean = match std::str::from_utf8(strip_bom(&disk_bytes)) {
                Ok(disk) => match merge_text(base, mine, disk) {
                    TextMerge::Clean(text) => Some(text),
                    TextMerge::Conflict => None,
                },
                // Lossy text could not be merged without losing bytes, so it is a clash.
                Err(_) => None,
            };
            before_write();
            match clean {
                Some(text) => {
                    match self.write_text_checked(rel, &text, Some(expected.as_str()))? {
                        WriteOutcome::Written { hash } => return Ok(MergeWrite::Merged { hash }),
                        WriteOutcome::Changed { .. } => {}
                    }
                }
                None => {
                    // The copy must hold the bytes that `mine` is about to replace, so it is
                    // written first. If this attempt loses the race, its copy is removed again
                    // (we just created it), so only the winning attempt leaves one copy.
                    let conflict_copy =
                        self.free_path(&conflict_copy_path(rel, &compact_stamp(now_ms())))?;
                    let copy_path = self.resolve(&conflict_copy)?;
                    // A file that appeared at the copy's name is never overwritten; the attempt
                    // starts over so the displaced bytes still get a copy of their own.
                    if let WriteOutcome::Changed { .. } =
                        self.write_bytes_checked(&conflict_copy, &disk_bytes, Some(""))?
                    {
                        continue;
                    }
                    match self.write_text_checked(rel, mine, Some(expected.as_str()))? {
                        WriteOutcome::Written { hash } => {
                            return Ok(MergeWrite::Conflict {
                                hash,
                                conflict_copy,
                            });
                        }
                        WriteOutcome::Changed { .. } => {
                            let _ = fs::remove_file(&copy_path);
                        }
                    }
                }
            }
        }
        Err(io_err(
            "write",
            rel,
            io::Error::other("the file kept changing during the merge"),
        ))
    }

    /// The first of `base`, `base-2`, `base-3`... that is not taken yet.
    fn free_path(&self, base: &str) -> Result<String, VaultError> {
        for n in 1..=FREE_NAME_TRIES {
            let candidate = numbered_path(base, n);
            if !taken(&self.resolve(&candidate)?) {
                return Ok(candidate);
            }
        }
        Err(io_err(
            "create",
            base,
            io::Error::new(io::ErrorKind::AlreadyExists, "no free file name"),
        ))
    }

    /// Compare the replaced bytes with what was expected; keep them if they differ.
    fn settle_prev(
        &self,
        rel: &str,
        prev: &Path,
        displaced: &str,
        text: bool,
    ) -> Result<(), VaultError> {
        let bytes = fs::read(prev).map_err(|source| io_err("read", rel, source))?;
        if hash_of(&bytes, text) == displaced {
            let _ = fs::remove_file(prev);
            return Ok(());
        }
        let copy = self.free_path(&conflict_copy_path(rel, &compact_stamp(now_ms())))?;
        let dest = self.resolve(&copy)?;
        fs::rename(prev, &dest).map_err(|source| io_err("rename", rel, source))
    }
}

/// The outcome of a write that put the new bytes at `target`, with their digest read back.
fn written(target: &Path, rel: &str, text: bool) -> Result<WriteOutcome, VaultError> {
    let now = fs::read(target).map_err(|source| io_err("read", rel, source))?;
    Ok(WriteOutcome::Written {
        hash: hash_of(&now, text),
    })
}

/// The bytes without a leading UTF-8 byte order mark.
fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes)
}

/// The file's text as the checked write sees it: BOM stripped, invalid bytes replaced.
fn decode_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(strip_bom(bytes)).into_owned()
}

/// Digest of text files by canonical text, other files by raw bytes.
fn hash_of(bytes: &[u8], text: bool) -> String {
    if text {
        canonical_digest(&decode_text(bytes))
    } else {
        bytes_digest(bytes)
    }
}

/// The file's bytes, or `None` when it does not exist.
fn read_disk(target: &Path, rel: &str) -> Result<Option<Vec<u8>>, VaultError> {
    match fs::read(target) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(io_err("read", rel, source)),
    }
}

/// The outcome to report when the file no longer matches `expected`; `None` to go ahead.
/// A missing file has the hash `""`, so `Some("")` means "create only if still absent".
fn check_expected(disk: Option<&[u8]>, text: bool, expected: Option<&str>) -> Option<WriteOutcome> {
    let expected = expected?;
    let disk_hash = disk.map_or_else(String::new, |bytes| hash_of(bytes, text));
    (disk_hash != expected).then_some(WriteOutcome::Changed { disk_hash })
}

/// Write the new bytes to the temp file and fsync them.
pub(crate) fn write_temp(temp: &Path, data: &[u8]) -> io::Result<()> {
    let mut file = fs::File::create(temp)?;
    file.write_all(data)?;
    file.sync_all()
}

/// Keep a copy of the current file as `<name>.wfprev`, by hard link when possible.
/// `None` when there is no file yet.
fn make_prev(target: &Path) -> io::Result<Option<PathBuf>> {
    if fs::symlink_metadata(target).is_err() {
        return Ok(None);
    }
    let prev = free_prev(target)?;
    if fs::hard_link(target, &prev).is_err()
        && let Err(source) = fs::copy(target, &prev)
    {
        let _ = fs::remove_file(&prev);
        return Err(source);
    }
    Ok(Some(prev))
}

/// The first `<name>.wfprev` (then `<name>.<n>.wfprev`) beside `target` that is not taken. An
/// existing `.wfprev` may hold the only copy of bytes a crash or a failed settle left behind, so
/// it is never overwritten.
fn free_prev(target: &Path) -> io::Result<PathBuf> {
    let base: OsString = target.file_name().unwrap_or_default().to_owned();
    for n in 0..FREE_NAME_TRIES {
        let mut name = base.clone();
        if n > 0 {
            name.push(format!(".{n}"));
        }
        name.push(PREV_SUFFIX);
        let candidate = target.with_file_name(name);
        if !taken(&candidate) {
            return Ok(candidate);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "no free .wfprev name",
    ))
}

/// Whether something already exists at `path`, even a dangling link.
fn taken(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// Whether `dest` exists and is not the file at `src_real` (case-only renames on a
/// case-insensitive disk point at the same file).
fn is_other_file(src_real: &Path, dest: &Path) -> bool {
    if !taken(dest) {
        return false;
    }
    !fs::canonicalize(dest).is_ok_and(|real| real.as_path() == src_real)
}

/// Current time as milliseconds since the Unix epoch.
fn now_ms() -> i64 {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    i64::try_from(ms).unwrap_or(i64::MAX)
}

/// Remove stale generated temp files under `dir`, not following links or entering `.git`.
fn sweep_dir(dir: &Path, depth: usize, cutoff: SystemTime, removed: &mut usize) {
    if depth > WALK_DEPTH_MAX {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if entry.file_name().to_str() != Some(".git") {
                sweep_dir(&entry.path(), depth + 1, cutoff, removed);
            }
        } else if kind.is_file()
            && is_stale_temp(&entry, cutoff)
            && fs::remove_file(entry.path()).is_ok()
        {
            *removed += 1;
        }
    }
}

/// Whether a generated temp file was last modified at or before `cutoff`. `.wfprev` files are
/// never swept: one may hold the only copy of bytes a crash left behind.
fn is_stale_temp(entry: &fs::DirEntry, cutoff: SystemTime) -> bool {
    let file_name = entry.file_name();
    let Some(name) = file_name.to_str() else {
        return false;
    };
    if !is_generated_temp(name) {
        return false;
    }
    entry
        .metadata()
        .and_then(|meta| meta.modified())
        .is_ok_and(|modified| modified <= cutoff)
}

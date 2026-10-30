//! File operations inside the workspace folder, confined to its root even through links.
//!
//! Limits, as in the desktop app: checking that a path stays inside the root and acting on
//! it are two steps, so another process swapping in a link between them can still escape;
//! writes rename a temp file over the target without an fsync, so power loss can lose the
//! latest write; temp files a crash leaves behind are hidden from listings but not swept
//! yet; and a file name near the filesystem's length limit cannot get a temp sibling.

use std::collections::{HashSet, VecDeque};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

use wf_core::workspace::{UnsafePath, safe_workspace_path};

/// Marks a write in progress; listings skip these so a crash mid-write shows no ghost file.
pub const TEMP_SUFFIX: &str = ".wftmp";

/// How many folders below the walked one [`Vault::walk`] descends; deeper files are left out.
pub const WALK_DEPTH_MAX: usize = 64;

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Whether a listed entry is a file or a folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    /// A regular file (links are followed, so a link to a file is a file).
    File,
    /// A folder.
    Dir,
}

/// One file or folder inside the workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Normalized path relative to the workspace root, `/`-separated.
    pub path: String,
    /// Size in bytes.
    pub size: u64,
    /// Last modification time.
    pub modified: SystemTime,
    /// File or folder.
    pub kind: EntryKind,
}

/// Why a vault operation failed.
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    /// The path itself is refused by `safe_workspace_path`.
    #[error("Unsafe workspace path: {0}")]
    UnsafePath(String),
    /// The path is inside the root by name but resolves outside it through a link.
    /// Shows the relative path, not the absolute one the desktop app shows, so the
    /// message never reveals where the workspace lives on disk.
    #[error("Path escapes the workspace folder: {0}")]
    Escape(String),
    /// The filesystem refused the operation.
    #[error("{op} {path}: {source}")]
    Io {
        /// The operation that failed, e.g. `write`.
        op: &'static str,
        /// The relative path it was run on.
        path: String,
        /// The underlying error.
        #[source]
        source: io::Error,
    },
}

impl From<UnsafePath> for VaultError {
    fn from(err: UnsafePath) -> Self {
        Self::UnsafePath(err.0)
    }
}

impl VaultError {
    /// The OS error kind for an [`VaultError::Io`]; `None` for refusals.
    #[must_use]
    pub fn io_kind(&self) -> Option<io::ErrorKind> {
        match self {
            Self::Io { source, .. } => Some(source.kind()),
            Self::UnsafePath(_) | Self::Escape(_) => None,
        }
    }
}

/// A workspace folder on disk; every path is checked before it is touched.
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    /// A vault rooted at `root`. Nothing is touched until an operation runs.
    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// The folder this vault is confined to.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The raw bytes of a file.
    ///
    /// # Errors
    /// Refused paths, escapes through links, or any read failure.
    pub fn read_file(&self, rel: &str) -> Result<Vec<u8>, VaultError> {
        let target = self.resolve(rel)?;
        fs::read(&target).map_err(|source| io_err("read", rel, source))
    }

    /// A file decoded as UTF-8 without a leading byte order mark, with invalid bytes
    /// replaced (matches `TextDecoder`).
    ///
    /// # Errors
    /// Same as [`Vault::read_file`].
    pub fn read_text(&self, rel: &str) -> Result<String, VaultError> {
        let bytes = self.read_file(rel)?;
        let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
        Ok(String::from_utf8_lossy(body).into_owned())
    }

    /// Replace a file's bytes, creating parent folders; never leaves a torn file behind.
    ///
    /// The data goes to a temp file beside the target, which is then renamed over it.
    ///
    /// # Errors
    /// Refused paths, escapes, or any write or rename failure (the temp file is removed).
    pub fn write_file(&self, rel: &str, data: &[u8]) -> Result<(), VaultError> {
        let target = self.resolve(rel)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|source| io_err("create folder", rel, source))?;
        }
        let temp = temp_beside(&target);
        let outcome = fs::write(&temp, data).and_then(|()| fs::rename(&temp, &target));
        outcome.map_err(|source| {
            // The temp may never have been created; removing a missing file is the same outcome.
            let _ = fs::remove_file(&temp);
            io_err("write", rel, source)
        })
    }

    /// Remove a file, or a folder when `recursive`; a missing path is not an error.
    /// A link to a folder is removed as a link; its target is left alone.
    ///
    /// # Errors
    /// Refused paths, escapes, a folder without `recursive`, or any removal failure.
    pub fn remove(&self, rel: &str, recursive: bool) -> Result<(), VaultError> {
        let target = self.resolve(rel)?;
        let meta = match fs::symlink_metadata(&target) {
            Ok(meta) => meta,
            Err(source) if source.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(source) => return Err(io_err("remove", rel, source)),
        };
        let outcome = if is_dir_link(&meta) {
            fs::remove_dir(&target)
        } else if !meta.is_dir() {
            fs::remove_file(&target)
        } else if recursive {
            fs::remove_dir_all(&target)
        } else {
            Err(io::Error::new(
                io::ErrorKind::IsADirectory,
                "a folder needs recursive removal",
            ))
        };
        outcome.map_err(|source| io_err("remove", rel, source))
    }

    /// Create a folder and any missing parents; an existing folder is fine.
    ///
    /// # Errors
    /// Refused paths, escapes, or a creation failure.
    pub fn mkdirp(&self, rel: &str) -> Result<(), VaultError> {
        let target = self.resolve(rel)?;
        fs::create_dir_all(&target).map_err(|source| io_err("create folder", rel, source))
    }

    /// The direct children of a folder, sorted by path; a missing folder lists as empty.
    ///
    /// Temp files and children that vanish or escape are left out.
    ///
    /// # Errors
    /// Refused paths, escapes, or a folder that exists but cannot be read.
    pub fn list(&self, dir: &str) -> Result<Vec<Entry>, VaultError> {
        let (at, target) = self.folder(dir)?;
        let reader = match fs::read_dir(&target) {
            Ok(reader) => reader,
            Err(source) if source.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(source) => return Err(io_err("list", &at, source)),
        };
        let mut out = Vec::new();
        for child in reader {
            let child = child.map_err(|source| io_err("list", &at, source))?;
            let Ok(name) = child.file_name().into_string() else {
                continue;
            };
            if name.ends_with(TEMP_SUFFIX) {
                continue;
            }
            let rel = if at.is_empty() {
                name
            } else {
                format!("{at}/{name}")
            };
            if let Some(entry) = self.stat(&rel) {
                out.push(entry);
            }
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    /// Every file under a folder; subfolders that cannot be read are skipped.
    ///
    /// Files reached without links come first, depth-first in list order; links to folders
    /// are followed afterwards, in the order they were met. Each real folder is entered once,
    /// so a file is listed under its real path when it has one, a link back up the tree
    /// cannot loop, and a folder reached only through a link is listed under the link's
    /// name. Folders more than [`WALK_DEPTH_MAX`] levels below `dir` are not entered.
    ///
    /// # Errors
    /// Only when the top folder itself cannot be listed.
    pub fn walk(&self, dir: &str) -> Result<Vec<Entry>, VaultError> {
        let entries = self.list(dir)?;
        let (_, top) = self.folder(dir)?;
        let mut seen = HashSet::new();
        if let Ok(real) = fs::canonicalize(&top) {
            let _ = seen.insert(real);
        }
        let mut links = VecDeque::new();
        let mut out = Vec::new();
        for entry in entries {
            self.collect(entry, 1, &mut seen, &mut links, &mut out);
        }
        while let Some((link, depth)) = links.pop_front() {
            self.enter(&link, depth, &mut seen, &mut links, &mut out);
        }
        Ok(out)
    }

    /// Metadata for one path, following links; any failure (refused, escaped, missing) is `None`.
    #[must_use]
    pub fn stat(&self, rel: &str) -> Option<Entry> {
        let safe = safe_workspace_path(rel).ok()?;
        let target = self.resolve(&safe).ok()?;
        let meta = fs::metadata(&target).ok()?;
        Some(Entry {
            path: safe,
            size: meta.len(),
            modified: meta.modified().ok()?,
            kind: if meta.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            },
        })
    }

    /// Move a file to a new path, creating its parent folders and replacing any file there.
    ///
    /// # Errors
    /// Refused or escaping paths (checked `to` first, then `from`), or the rename failing.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), VaultError> {
        let dest = self.resolve(to)?;
        let src = self.resolve(from)?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|source| io_err("create folder", to, source))?;
        }
        fs::rename(&src, &dest).map_err(|source| io_err("rename", from, source))
    }

    /// Normalized relative folder and its absolute target; `""` and `"."` are the root.
    fn folder(&self, dir: &str) -> Result<(String, PathBuf), VaultError> {
        if dir.is_empty() || dir == "." {
            return Ok((String::new(), self.root.clone()));
        }
        let safe = safe_workspace_path(dir)?;
        let target = self.resolve(&safe)?;
        Ok((safe, target))
    }

    /// Append `entry` if it is a file, queue it in `links` if it is a link to a folder, or
    /// else walk the folder `depth` levels down.
    fn collect(
        &self,
        entry: Entry,
        depth: usize,
        seen: &mut HashSet<PathBuf>,
        links: &mut VecDeque<(Entry, usize)>,
        out: &mut Vec<Entry>,
    ) {
        if entry.kind == EntryKind::File {
            out.push(entry);
            return;
        }
        let is_link = self
            .resolve(&entry.path)
            .ok()
            .and_then(|p| fs::symlink_metadata(p).ok())
            .is_some_and(|meta| meta.file_type().is_symlink());
        if is_link {
            links.push_back((entry, depth));
            return;
        }
        self.enter(&entry, depth, seen, links, out);
    }

    /// Collect every child of the folder `entry`, `depth` levels down, when that is within
    /// [`WALK_DEPTH_MAX`] and its real path is not in `seen` yet.
    fn enter(
        &self,
        entry: &Entry,
        depth: usize,
        seen: &mut HashSet<PathBuf>,
        links: &mut VecDeque<(Entry, usize)>,
        out: &mut Vec<Entry>,
    ) {
        if depth > WALK_DEPTH_MAX {
            return;
        }
        let real = self
            .resolve(&entry.path)
            .ok()
            .and_then(|p| fs::canonicalize(p).ok());
        if !real.is_some_and(|real| seen.insert(real)) {
            return;
        }
        let Ok(children) = self.list(&entry.path) else {
            return;
        };
        for child in children {
            self.collect(child, depth + 1, seen, links, out);
        }
    }

    /// Map a relative path to an absolute one inside the root, or refuse it.
    fn resolve(&self, rel: &str) -> Result<PathBuf, VaultError> {
        let safe = safe_workspace_path(rel)?;
        let target = safe
            .split('/')
            .fold(self.root.clone(), |acc, segment| acc.join(segment));
        assert_inside(&self.root, &target, rel)?;
        Ok(target)
    }
}

fn io_err(op: &'static str, path: &str, source: io::Error) -> VaultError {
    VaultError::Io {
        op,
        path: path.to_owned(),
        source,
    }
}

/// Whether `meta` (from `symlink_metadata`) is a Windows folder link or junction, which
/// `remove_file` cannot delete; elsewhere a link to a folder is removed like a file.
#[cfg(windows)]
fn is_dir_link(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::FileTypeExt;
    meta.file_type().is_symlink_dir()
}

/// Whether `meta` is a folder link `remove_file` cannot delete: never, off Windows.
#[cfg(not(windows))]
fn is_dir_link(_meta: &fs::Metadata) -> bool {
    false
}

/// A unique sibling of `target` named `<file name>.<pid>.<seq>.wftmp`.
fn temp_beside(target: &Path) -> PathBuf {
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let mut name: OsString = target
        .file_name()
        .map(ToOwned::to_owned)
        .unwrap_or_default();
    name.push(format!(".{}.{seq}{TEMP_SUFFIX}", std::process::id()));
    target.with_file_name(name)
}

/// The deepest ancestor of `target` that exists (canonicalized), with the missing tail below it.
fn nearest_existing(target: &Path) -> Option<(PathBuf, PathBuf)> {
    let mut tail = PathBuf::new();
    let mut cursor = target;
    loop {
        if let Ok(real) = fs::canonicalize(cursor) {
            return Some((real, tail));
        }
        tail = Path::new(cursor.file_name()?).join(&tail);
        cursor = cursor.parent()?;
    }
}

/// `..` and absolute paths are already refused, so the only way out left is a link planted
/// inside the folder. A write `mkdir -p`s the rest, which follows a linked ancestor, so the
/// nearest existing ancestor is what gets checked.
fn assert_inside(root: &Path, target: &Path, shown: &str) -> Result<(), VaultError> {
    let Some((existing, tail)) = nearest_existing(target) else {
        return Ok(());
    };
    let real_root = fs::canonicalize(root)
        .map_err(|source| io_err("open workspace folder", &root.to_string_lossy(), source))?;
    if existing.join(tail).strip_prefix(&real_root).is_err() {
        return Err(VaultError::Escape(shown.to_owned()));
    }
    Ok(())
}

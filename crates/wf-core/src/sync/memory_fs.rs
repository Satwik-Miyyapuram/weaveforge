//! Map-backed `WorkspaceFs` for tests and the serializer. Ports
//! `packages/core/src/testing/memory-workspace-fs.ts`.

use std::collections::{BTreeMap, BTreeSet};

use crate::sync::workspace_fs::{FsError, FsKind, WorkspaceFs, WorkspaceStat, decode_text};
use crate::workspace::safe_workspace_path;

/// Map-backed filesystem. Listings sort by plain byte order of the path (TS uses `localeCompare`).
pub struct MemoryWorkspaceFs {
    files: BTreeMap<String, Vec<u8>>,
    dirs: BTreeSet<String>,
    times: BTreeMap<String, u64>,
    clock: Box<dyn Fn() -> u64>,
}

impl MemoryWorkspaceFs {
    /// Empty filesystem stamped with the system clock.
    #[must_use]
    pub fn new() -> Self {
        Self::with_clock(Box::new(now_ms))
    }

    /// Empty filesystem stamped with `clock`, in milliseconds since the Unix epoch.
    #[must_use]
    pub fn with_clock(clock: Box<dyn Fn() -> u64>) -> Self {
        Self {
            files: BTreeMap::new(),
            dirs: BTreeSet::new(),
            times: BTreeMap::new(),
            clock,
        }
    }

    /// Test helper: the whole tree as a path→text map.
    #[must_use]
    pub fn to_record(&self) -> BTreeMap<String, String> {
        self.files
            .iter()
            .map(|(path, bytes)| (path.clone(), decode_text(bytes)))
            .collect()
    }

    fn now(&self) -> u64 {
        (self.clock)()
    }

    fn add_parent_dirs(&mut self, safe: &str) {
        for (i, _) in safe.match_indices('/') {
            let _ = self.dirs.insert(safe[..i].to_owned());
        }
    }

    fn file_stat(&self, path: &str, bytes: &[u8]) -> WorkspaceStat {
        WorkspaceStat {
            path: path.to_owned(),
            size: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
            modified_ms: self.times.get(path).copied().unwrap_or_else(|| self.now()),
            kind: FsKind::File,
        }
    }

    fn dir_stat(&self, path: String) -> WorkspaceStat {
        WorkspaceStat {
            path,
            size: 0,
            modified_ms: self.now(),
            kind: FsKind::Dir,
        }
    }
}

impl Default for MemoryWorkspaceFs {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for MemoryWorkspaceFs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MemoryWorkspaceFs")
            .field("files", &self.files)
            .field("dirs", &self.dirs)
            .field("times", &self.times)
            .finish_non_exhaustive()
    }
}

impl WorkspaceFs for MemoryWorkspaceFs {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, FsError> {
        let safe = safe_workspace_path(path)?;
        self.files
            .get(&safe)
            .cloned()
            .ok_or_else(|| FsError::NotFound(path.to_owned()))
    }

    fn read_text(&self, path: &str) -> Result<String, FsError> {
        Ok(decode_text(&self.read_file(path)?))
    }

    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), FsError> {
        let safe = safe_workspace_path(path)?;
        let at = self.now();
        let _ = self.files.insert(safe.clone(), data.to_vec());
        let _ = self.times.insert(safe.clone(), at);
        self.add_parent_dirs(&safe);
        Ok(())
    }

    fn remove(&mut self, path: &str, recursive: bool) -> Result<(), FsError> {
        let safe = safe_workspace_path(path)?;
        let _ = self.files.remove(&safe);
        if recursive {
            let child = format!("{safe}/");
            self.files.retain(|key, _| !key.starts_with(child.as_str()));
            self.dirs
                .retain(|key| key != &safe && !key.starts_with(child.as_str()));
        }
        Ok(())
    }

    fn mkdirp(&mut self, path: &str) -> Result<(), FsError> {
        let safe = safe_workspace_path(path)?;
        self.add_parent_dirs(&safe);
        let _ = self.dirs.insert(safe);
        Ok(())
    }

    /// Sorted by plain byte order of the path, not `localeCompare`.
    fn list(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        let prefix = prefix_of(dir)?;
        let mut seen = BTreeMap::new();
        for (path, bytes) in &self.files {
            let Some(rest) = path.strip_prefix(prefix.as_str()) else {
                continue;
            };
            let entry = match rest.split_once('/') {
                None => self.file_stat(path, bytes),
                Some((head, _)) => self.dir_stat(format!("{prefix}{head}")),
            };
            let _ = seen.insert(entry.path.clone(), entry);
        }
        Ok(seen.into_values().collect())
    }

    fn walk(&self, dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        let prefix = prefix_of(dir)?;
        Ok(self
            .files
            .iter()
            .filter(|(path, _)| path.starts_with(prefix.as_str()))
            .map(|(path, bytes)| self.file_stat(path, bytes))
            .collect())
    }

    fn stat(&self, path: &str) -> Option<WorkspaceStat> {
        let safe = safe_workspace_path(path).ok()?;
        if let Some(bytes) = self.files.get(&safe) {
            return Some(self.file_stat(&safe, bytes));
        }
        self.dirs
            .contains(&safe)
            .then(|| self.dir_stat(safe.clone()))
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError> {
        let source = safe_workspace_path(from)?;
        let target = safe_workspace_path(to)?;
        let bytes = self
            .files
            .remove(&source)
            .ok_or_else(|| FsError::NotFound(from.to_owned()))?;
        self.write_file(&target, &bytes)
    }
}

/// Listing prefix for `dir`: empty for the root, else the safe path followed by `/`.
fn prefix_of(dir: &str) -> Result<String, FsError> {
    if dir.is_empty() {
        return Ok(String::new());
    }
    Ok(format!("{}/", safe_workspace_path(dir)?))
}

/// Milliseconds since the Unix epoch; 0 if the system clock is before it.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

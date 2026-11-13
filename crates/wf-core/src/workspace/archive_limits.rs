//! Limits on an imported archive: entry count, file size and total expansion.
//! Decided from names and sizes only; the bytes stay with the caller.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::is_safe_workspace_path;

const MIB: f64 = 1024.0 * 1024.0;

/// The caps an import is held to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ArchiveLimits {
    /// Total uncompressed bytes across every entry.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub max_total_bytes: u64,
    /// One file.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub max_file_bytes: u64,
    /// Entries, directories included.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub max_entries: u64,
}

/// A directory's name and size as an archive declares them, before inflating.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct EntryInfo {
    /// Path inside the archive, `/`-separated.
    pub name: String,
    /// Uncompressed size in bytes.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub size: u64,
}

/// What an import does with one entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum EntryAction {
    /// Import it.
    Keep,
    /// A directory marker or an empty file: nothing to import.
    Empty,
    /// Its name could reach outside the folder.
    UnsafeName,
    /// Over the file cap.
    TooBig,
}

/// One entry of an archive and the action an import takes on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlannedEntry {
    /// The entry's name, as archived.
    pub name: String,
    /// What to do with it.
    pub action: EntryAction,
}

// Whole megabytes of a cap the caller set: non-negative and far below u64 range, so the cast is exact.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn total_message(limits: &ArchiveLimits) -> String {
    format!(
        "Archive expands past {} MB; refusing to continue.",
        (limits.max_total_bytes as f64 / MIB).round() as u64
    )
}

/// Declared sizes, checked from the archive's directory before anything is inflated.
#[derive(Debug, Clone)]
pub struct ArchiveBudget {
    limits: ArchiveLimits,
    count: u64,
    total: u64,
    oversize: Vec<String>,
}

impl ArchiveBudget {
    /// A budget that has seen no entries yet.
    #[must_use]
    pub fn new(limits: ArchiveLimits) -> Self {
        Self {
            limits,
            count: 0,
            total: 0,
            oversize: Vec::new(),
        }
    }

    /// Whether to inflate an entry of this declared size. An entry over the file
    /// cap is refused and remembered in [`oversize`](Self::oversize).
    ///
    /// # Errors
    ///
    /// Fails past the entry count or the total cap, since nothing can then be
    /// trusted to finish.
    pub fn admit(&mut self, name: &str, original_size: u64) -> Result<bool, String> {
        self.count += 1;
        if self.count > self.limits.max_entries {
            return Err(format!(
                "Archive has more than {} entries.",
                self.limits.max_entries
            ));
        }
        if original_size > self.limits.max_file_bytes {
            self.oversize.push(name.to_owned());
            return Ok(false);
        }
        self.total += original_size;
        if self.total > self.limits.max_total_bytes {
            return Err(total_message(&self.limits));
        }
        Ok(true)
    }

    /// Entries refused as over the file cap, in archive order.
    #[must_use]
    pub fn oversize(&self) -> &[String] {
        &self.oversize
    }
}

/// Decide each entry of an inflated archive, in archive order.
///
/// Unsafe names and entries over the file cap are skipped, not fatal: one bad
/// name should not cost the whole import. The count and total caps are fatal.
///
/// # Errors
///
/// Fails past the entry count or the total cap.
pub fn plan_entries(
    entries: &[EntryInfo],
    limits: &ArchiveLimits,
) -> Result<Vec<PlannedEntry>, String> {
    if entries.len() as u64 > limits.max_entries {
        return Err(format!(
            "Archive has {} entries, over the {} limit.",
            entries.len(),
            limits.max_entries
        ));
    }
    let mut total = 0_u64;
    let mut plan = Vec::with_capacity(entries.len());
    for entry in entries {
        let action = if entry.name.ends_with('/') || entry.size == 0 {
            EntryAction::Empty
        } else if !is_safe_workspace_path(&entry.name) {
            EntryAction::UnsafeName
        } else if entry.size > limits.max_file_bytes {
            EntryAction::TooBig
        } else {
            total += entry.size;
            if total > limits.max_total_bytes {
                return Err(total_message(limits));
            }
            EntryAction::Keep
        };
        plan.push(PlannedEntry {
            name: entry.name.clone(),
            action,
        });
    }
    Ok(plan)
}

/// Strip the single directory an export ZIP wraps its files in, so
/// `weaveforge-2026/notes/x.md` becomes `notes/x.md`. Unchanged unless every
/// path sits under one root and something remains after it.
#[must_use]
pub fn strip_archive_root(paths: &[String]) -> Vec<String> {
    let roots: BTreeSet<&str> = paths
        .iter()
        .map(|path| path.split('/').next().unwrap_or_default())
        .collect();
    let root = match roots.iter().next() {
        Some(first) if roots.len() == 1 => format!("{first}/"),
        _ => return paths.to_vec(),
    };
    if !paths
        .iter()
        .all(|path| path.starts_with(&root) && path.len() > root.len())
    {
        return paths.to_vec();
    }
    paths
        .iter()
        .map(|path| path[root.len()..].to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        ArchiveBudget, ArchiveLimits, EntryAction, EntryInfo, plan_entries, strip_archive_root,
    };

    const LIMITS: ArchiveLimits = ArchiveLimits {
        max_total_bytes: 15,
        max_file_bytes: 10,
        max_entries: 3,
    };

    fn entry(name: &str, size: u64) -> EntryInfo {
        EntryInfo {
            name: name.to_owned(),
            size,
        }
    }

    #[test]
    fn budget_refuses_an_oversize_entry_and_remembers_it() {
        let mut budget = ArchiveBudget::new(LIMITS);
        assert_eq!(budget.admit("small.md", 4), Ok(true));
        assert_eq!(budget.admit("big.md", 11), Ok(false));
        assert_eq!(budget.oversize(), ["big.md"]);
    }

    #[test]
    fn budget_throws_past_the_entry_count_and_the_total() {
        let mut count = ArchiveBudget::new(LIMITS);
        for _ in 0..3 {
            assert_eq!(count.admit("a", 1), Ok(true));
        }
        assert!(count.admit("a", 1).is_err());

        let mut total = ArchiveBudget::new(LIMITS);
        assert_eq!(total.admit("a", 10), Ok(true));
        assert!(total.admit("b", 6).is_err());
    }

    #[test]
    fn plan_skips_empty_unsafe_and_oversize_entries() {
        let plan = plan_entries(
            &[
                entry("dir/", 0),
                entry("empty.md", 0),
                entry("../escape.md", 2),
                entry("huge.md", 11),
                entry("ok.md", 3),
            ],
            &ArchiveLimits {
                max_entries: 10,
                ..LIMITS
            },
        )
        .expect("within limits");
        let actions: Vec<EntryAction> = plan.iter().map(|item| item.action).collect();
        assert_eq!(
            actions,
            [
                EntryAction::Empty,
                EntryAction::Empty,
                EntryAction::UnsafeName,
                EntryAction::TooBig,
                EntryAction::Keep,
            ]
        );
    }

    #[test]
    fn plan_throws_past_the_count_and_the_total() {
        let four = [entry("a", 1), entry("b", 1), entry("c", 1), entry("d", 1)];
        assert!(plan_entries(&four, &LIMITS).is_err());

        let over = [entry("a", 9), entry("b", 9)];
        assert!(plan_entries(&over, &LIMITS).is_err());
    }

    #[test]
    fn strips_a_single_wrapping_root() {
        let paths = ["export-1/notes/x.md".to_owned(), "export-1/y.md".to_owned()];
        assert_eq!(strip_archive_root(&paths), ["notes/x.md", "y.md"]);
    }

    #[test]
    fn keeps_paths_when_roots_differ_or_nothing_would_remain() {
        let mixed = ["a/x.md".to_owned(), "b/y.md".to_owned()];
        assert_eq!(strip_archive_root(&mixed), mixed);

        let bare = ["root.md".to_owned()];
        assert_eq!(strip_archive_root(&bare), bare);

        let only_root = ["export/".to_owned()];
        assert_eq!(strip_archive_root(&only_root), only_root);

        let none: [String; 0] = [];
        assert!(strip_archive_root(&none).is_empty());
    }
}

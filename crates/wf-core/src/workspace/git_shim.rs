//! Path and status decisions behind the isomorphic-git fs shim (`IsomorphicWorkspaceGit`
//! in `apps/web/src/features/workspace/infrastructure/parts.ts`). The fs calls themselves
//! and the isomorphic-git calls stay in TypeScript.

use std::collections::HashSet;

use crate::sync::git_policy::{GitSyncDecision, decide_git_sync_path};

/// Strips leading and trailing slashes from an isomorphic-git `dir`/path. `.` means the repo
/// root, as does the empty string, so both come back as `""`.
#[must_use]
pub fn normalize_repo_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/').trim_end_matches('/');
    if trimmed == "." {
        String::new()
    } else {
        trimmed.to_owned()
    }
}

/// Maps one `statusMatrix` row (`head`, `workdir`; 0 absent, 1 unchanged, 2 modified) to a
/// change state, or `None` when the file is unchanged.
#[must_use]
pub fn git_status_state(head: u8, workdir: u8) -> Option<&'static str> {
    match (head, workdir) {
        (0, w) if w > 0 => Some("added"),
        (h, 0) if h > 0 => Some("deleted"),
        (h, 2) if h > 0 => Some("modified"),
        _ => None,
    }
}

/// What `unstageOutOfScope` does with an index entry whose stage differs from HEAD.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnstageAction {
    /// The stage matches HEAD; nothing to undo.
    Keep,
    /// HEAD has no such file; remove it from the index.
    Remove,
    /// HEAD has the file; reset the index entry to HEAD.
    ResetToHead,
}

impl UnstageAction {
    /// The wire name read by the TypeScript caller.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Keep => "keep",
            Self::Remove => "remove",
            Self::ResetToHead => "reset",
        }
    }
}

/// Decides the unstage action from a `statusMatrix` row's `head` and `stage` values.
#[must_use]
pub fn unstage_action(head: u8, stage: u8) -> UnstageAction {
    if stage == head {
        UnstageAction::Keep
    } else if head == 0 {
        UnstageAction::Remove
    } else {
        UnstageAction::ResetToHead
    }
}

/// Index entries `unstageOutOfScope` must recheck: not kept, and either just skipped for size
/// or excluded by the sync policy at size zero. Input order is preserved.
#[must_use]
pub fn out_of_scope_strays(
    indexed: &[String],
    kept: &[String],
    skipped: &[String],
    max_file_bytes: f64,
) -> Vec<String> {
    let kept: HashSet<&str> = kept.iter().map(String::as_str).collect();
    let skipped: HashSet<&str> = skipped.iter().map(String::as_str).collect();
    indexed
        .iter()
        .filter(|path| {
            let path = path.as_str();
            !kept.contains(path)
                && (skipped.contains(path)
                    || !matches!(
                        decide_git_sync_path(path, 0.0, max_file_bytes),
                        GitSyncDecision::Include
                    ))
        })
        .cloned()
        .collect()
}

/// Entry names directly under `dir` from full repo paths, sorted in UTF-16 code-unit order to
/// match the JavaScript default sort the TypeScript caller used before.
#[must_use]
pub fn dir_entry_names(paths: &[String], dir: &str) -> Vec<String> {
    let prefix = if dir.is_empty() {
        String::new()
    } else {
        format!("{dir}/")
    };
    let mut names: Vec<String> = paths
        .iter()
        .map(|path| {
            path.strip_prefix(prefix.as_str())
                .unwrap_or(path)
                .to_owned()
        })
        .collect();
    names.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    names
}

/// Splits a repo-relative path into `[parent, name]`. The parent is `""` at the root.
#[must_use]
pub fn split_leaf(path: &str) -> Vec<String> {
    match path.rsplit_once('/') {
        Some((parent, name)) => vec![parent.to_owned(), name.to_owned()],
        None => vec![String::new(), path.to_owned()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn normalize_strips_slashes_and_maps_dot_to_root() {
        assert_eq!(normalize_repo_path("/a/b/"), "a/b");
        assert_eq!(normalize_repo_path("//x"), "x");
        assert_eq!(normalize_repo_path("."), "");
        assert_eq!(normalize_repo_path("/."), "");
        assert_eq!(normalize_repo_path("/"), "");
        assert_eq!(normalize_repo_path(""), "");
        assert_eq!(normalize_repo_path("./a"), "./a");
    }

    #[test]
    fn status_row_maps_to_added_deleted_or_modified() {
        assert_eq!(git_status_state(0, 2), Some("added"));
        assert_eq!(git_status_state(0, 1), Some("added"));
        assert_eq!(git_status_state(1, 0), Some("deleted"));
        assert_eq!(git_status_state(2, 0), Some("deleted"));
        assert_eq!(git_status_state(1, 2), Some("modified"));
        assert_eq!(git_status_state(2, 2), Some("modified"));
        assert_eq!(git_status_state(1, 1), None);
        assert_eq!(git_status_state(0, 0), None);
    }

    #[test]
    fn unstage_action_follows_head_and_stage() {
        assert_eq!(unstage_action(1, 1), UnstageAction::Keep);
        assert_eq!(unstage_action(0, 0), UnstageAction::Keep);
        assert_eq!(unstage_action(0, 1), UnstageAction::Remove);
        assert_eq!(unstage_action(1, 0), UnstageAction::ResetToHead);
        assert_eq!(UnstageAction::ResetToHead.as_str(), "reset");
    }

    #[test]
    fn strays_are_policy_excluded_or_skipped_and_not_kept() {
        let indexed = owned(&["a.md", "node_modules/x.js", "big.bin", "desktop.ini"]);
        let strays = out_of_scope_strays(&indexed, &owned(&["a.md"]), &owned(&["big.bin"]), 1024.0);
        assert_eq!(
            strays,
            owned(&["node_modules/x.js", "big.bin", "desktop.ini"])
        );
    }

    #[test]
    fn entry_names_are_direct_children_in_utf16_order() {
        let paths = owned(&["notes/b.md", "notes/a.md", "notes/sub"]);
        assert_eq!(
            dir_entry_names(&paths, "notes"),
            owned(&["a.md", "b.md", "sub"])
        );
        assert_eq!(
            dir_entry_names(&owned(&["z.md", "a.md"]), ""),
            owned(&["a.md", "z.md"])
        );
        // U+1F600 is a surrogate pair starting at 0xD83D, below U+FFFD in UTF-16 order.
        let astral = owned(&["\u{FFFD}", "\u{1F600}"]);
        assert_eq!(
            dir_entry_names(&astral, ""),
            owned(&["\u{1F600}", "\u{FFFD}"])
        );
    }

    #[test]
    fn leaf_split_separates_parent_and_name() {
        assert_eq!(split_leaf("a"), owned(&["", "a"]));
        assert_eq!(split_leaf("a/b/c"), owned(&["a/b", "c"]));
        assert_eq!(split_leaf(""), owned(&["", ""]));
    }
}

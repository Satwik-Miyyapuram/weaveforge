//! Key plan for purging a user's stored blobs (TS `purgeUserBlobs` and `removeStoragePrefix` in
//! apps/web/src/backend/account/purge-user-blobs.ts). Pure: the registry reads, the storage listing
//! calls, the removals and the throw stay in TS. These functions decide what those calls are given.

use serde::{Deserialize, Serialize};

/// One listing call returns at most this many entries; longer prefixes are paged.
pub const STORAGE_LIST_PAGE: usize = 200;

/// One entry from a storage listing. `is_file` is true when the listing gave the entry an id
/// (a file); otherwise it is a folder to descend into.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedEntry {
    /// The entry's name in the listing.
    pub name: String,
    /// Whether the entry is a file rather than a folder.
    pub is_file: bool,
}

/// The entries of one listing, split into object keys to delete and folders to list next.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ListingSplit {
    /// Object keys to delete.
    pub files: Vec<String>,
    /// Folders to list next.
    pub folders: Vec<String>,
}

/// Whether object removal runs at all: only the tiered provider, and only when the user has rows.
#[must_use]
pub fn purges_objects(provider: &str, row_count: usize) -> bool {
    provider == "tiered" && row_count > 0
}

/// Full key of `name` under `current` (the empty prefix is the bucket root).
fn join_key(current: &str, name: &str) -> String {
    if current.is_empty() {
        name.to_owned()
    } else {
        format!("{current}/{name}")
    }
}

/// Split one listing of `current` into file keys and folder keys, both as full paths.
#[must_use]
pub fn split_storage_listing(current: &str, entries: &[ListedEntry]) -> ListingSplit {
    let mut split = ListingSplit::default();
    for entry in entries {
        let full = join_key(current, &entry.name);
        if entry.is_file {
            split.files.push(full);
        } else {
            split.folders.push(full);
        }
    }
    split
}

/// True when a listing page was full, so the next offset may hold more entries.
#[must_use]
pub fn storage_listing_has_more(count: usize) -> bool {
    count >= STORAGE_LIST_PAGE
}

/// The message thrown when some objects could not be removed; rows stay for a retry.
#[must_use]
pub fn purge_failure_message(failed: usize, total: usize) -> String {
    format!(
        "Could not delete {failed} of {total} stored objects — account not deleted. Retry once object storage is reachable."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, is_file: bool) -> ListedEntry {
        ListedEntry {
            name: name.to_owned(),
            is_file,
        }
    }

    #[test]
    fn objects_are_purged_only_for_tiered_with_rows() {
        assert!(purges_objects("tiered", 1));
        assert!(!purges_objects("tiered", 0));
        assert!(!purges_objects("local", 5));
    }

    #[test]
    fn root_listing_keys_are_bare_names() {
        let split = split_storage_listing("", &[entry("a.png", true), entry("notes", false)]);
        assert_eq!(split.files, vec!["a.png".to_owned()]);
        assert_eq!(split.folders, vec!["notes".to_owned()]);
    }

    #[test]
    fn nested_listing_keys_are_joined_with_slashes() {
        let split = split_storage_listing(
            "user-1/notes",
            &[entry("p1.webp", true), entry("deep", false)],
        );
        assert_eq!(split.files, vec!["user-1/notes/p1.webp".to_owned()]);
        assert_eq!(split.folders, vec!["user-1/notes/deep".to_owned()]);
    }

    #[test]
    fn a_full_page_means_more_may_follow() {
        assert!(!storage_listing_has_more(0));
        assert!(!storage_listing_has_more(STORAGE_LIST_PAGE - 1));
        assert!(storage_listing_has_more(STORAGE_LIST_PAGE));
    }

    #[test]
    fn failure_message_counts_failed_and_total() {
        assert_eq!(
            purge_failure_message(2, 7),
            "Could not delete 2 of 7 stored objects — account not deleted. Retry once object storage is reachable."
        );
    }
}

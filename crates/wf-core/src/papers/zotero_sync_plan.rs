//! The decisions of one Zotero sync, made once from a snapshot of the remote and local libraries
//! (TS `ZoteroSync`). Pull, push and delete all read the snapshot as it stood before any write, so
//! the whole plan is known up front. The TS side only performs the I/O the plan names.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::zotero_mapping::{ZoteroItem, zotero_arxiv_id, zotero_content_keys};

/// A local paper as the sync matches it: its identifiers and the Zotero key it already carries.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroSyncLocal {
    /// The paper's DOI, if known.
    pub doi: Option<String>,
    /// The paper's arXiv id, if known.
    pub arxiv_id: Option<String>,
    /// The paper's title, if known.
    pub title: Option<String>,
    /// The paper's Zotero item key, if linked.
    pub zotero_key: Option<String>,
}

/// Which remote items to pull and which local papers to push or delete. `pull` indexes the remote
/// list; `push` and `delete` index the local list.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ZoteroSyncPlan {
    /// Indices into the remote list to pull.
    pub pull: Vec<usize>,
    /// Indices into the local list to push to Zotero.
    pub push: Vec<usize>,
    /// Indices into the local list to delete.
    pub delete: Vec<usize>,
}

/// Plan one sync. `remote` is the list after the top-level and titled filters, so its indices are
/// the ones the caller pulls by.
#[must_use]
pub fn sync_plan(remote: &[ZoteroItem], local: &[ZoteroSyncLocal]) -> ZoteroSyncPlan {
    let remote_keys: Vec<Vec<String>> = remote.iter().map(remote_content_keys).collect();
    let local_keys: Vec<Vec<String>> = local.iter().map(local_content_keys).collect();
    let remote_match: HashSet<&str> = remote_keys
        .iter()
        .flatten()
        .map(String::as_str)
        .collect();

    // A remote item is pulled only when none of its keys is known yet. Pulled items join the known
    // set as they are taken, so two remote items sharing a key pull only the first.
    let mut known: HashSet<String> = local_keys.iter().flatten().cloned().collect();
    let mut pull = Vec::new();
    for (index, keys) in remote_keys.iter().enumerate() {
        if keys.is_empty() || keys.iter().any(|key| known.contains(key)) {
            continue;
        }
        pull.push(index);
        known.extend(keys.iter().cloned());
    }

    // A row with a stored key already lives in Zotero, so it is never a push candidate again.
    let mut push = Vec::new();
    let mut delete = Vec::new();
    let remote_item_keys: HashSet<&str> = remote
        .iter()
        .filter_map(|item| item.key.as_deref())
        .filter(|key| !key.is_empty())
        .collect();
    for (index, (paper, keys)) in local.iter().zip(&local_keys).enumerate() {
        if !has_zotero_key(paper) && !keys.is_empty() && !matches_remote(keys, &remote_match) {
            push.push(index);
        }
        // Delete only a row whose item is truly gone, and never on an empty remote read, so a
        // partial or failed read cannot mass-delete the library.
        if !remote.is_empty() && is_gone(paper, &remote_item_keys) && !matches_remote(keys, &remote_match) {
            delete.push(index);
        }
    }

    ZoteroSyncPlan { pull, push, delete }
}

fn remote_content_keys(item: &ZoteroItem) -> Vec<String> {
    let arxiv_id = zotero_arxiv_id(item);
    zotero_content_keys(item.doi.as_deref(), arxiv_id.as_deref(), item.title.as_deref())
}

fn local_content_keys(paper: &ZoteroSyncLocal) -> Vec<String> {
    zotero_content_keys(
        paper.doi.as_deref(),
        paper.arxiv_id.as_deref(),
        paper.title.as_deref(),
    )
}

fn has_zotero_key(paper: &ZoteroSyncLocal) -> bool {
    paper.zotero_key.as_deref().is_some_and(|key| !key.is_empty())
}

/// True when the paper's stored key names an item no longer in the remote list.
fn is_gone(paper: &ZoteroSyncLocal, remote_item_keys: &HashSet<&str>) -> bool {
    paper
        .zotero_key
        .as_deref()
        .is_some_and(|key| !key.is_empty() && !remote_item_keys.contains(key))
}

fn matches_remote(keys: &[String], remote_match: &HashSet<&str>) -> bool {
    keys.iter().any(|key| remote_match.contains(key.as_str()))
}

#[cfg(test)]
mod tests {
    // Plain-comment tests: the TS sync tests in zotero-sync-top-level.test.ts stay where they are
    // and exercise this plan through the wasm binding.

    use serde_json::{Value, json};

    use super::*;

    fn remote(value: Value) -> ZoteroItem {
        serde_json::from_value(value).expect("a remote item")
    }

    fn local(doi: Option<&str>, title: Option<&str>, zotero_key: Option<&str>) -> ZoteroSyncLocal {
        ZoteroSyncLocal {
            doi: doi.map(str::to_owned),
            arxiv_id: None,
            title: title.map(str::to_owned),
            zotero_key: zotero_key.map(str::to_owned),
        }
    }

    #[test]
    fn pull_takes_only_remote_items_with_no_local_match() {
        let remote_items = [
            remote(json!({ "key": "K1", "title": "A", "DOI": "10.1/a" })),
            remote(json!({ "key": "K2", "title": "B", "DOI": "10.1/b" })),
        ];
        let local_papers = [local(Some("10.1/a"), Some("A"), None)];
        let plan = sync_plan(&remote_items, &local_papers);
        assert_eq!(plan.pull, vec![1]);
    }

    #[test]
    fn pull_takes_one_of_two_remote_items_sharing_a_key() {
        let remote_items = [
            remote(json!({ "key": "K1", "title": "A", "DOI": "10.1/a" })),
            remote(json!({ "key": "K2", "title": "A again", "DOI": "10.1/a" })),
        ];
        let plan = sync_plan(&remote_items, &[]);
        assert_eq!(plan.pull, vec![0]);
    }

    #[test]
    fn push_sends_only_unkeyed_papers_with_no_remote_match() {
        let remote_items = [remote(json!({ "key": "K1", "title": "A", "DOI": "10.1/a" }))];
        let local_papers = [
            local(Some("10.1/c"), Some("C"), None),
            local(Some("10.1/a"), Some("A"), None),
            local(Some("10.1/d"), Some("D"), Some("K9")),
            local(None, None, None),
        ];
        let plan = sync_plan(&remote_items, &local_papers);
        assert_eq!(plan.push, vec![0]);
    }

    #[test]
    fn delete_removes_keyed_papers_whose_item_is_gone() {
        let remote_items = [remote(json!({ "key": "K1", "title": "A", "DOI": "10.1/a" }))];
        let local_papers = [
            local(Some("10.1/a"), Some("A"), Some("K1")),
            local(Some("10.1/z"), Some("Z"), Some("K7")),
        ];
        let plan = sync_plan(&remote_items, &local_papers);
        assert_eq!(plan.delete, vec![1]);
        assert!(plan.push.is_empty());
    }

    #[test]
    fn delete_is_skipped_when_the_remote_read_is_empty() {
        let local_papers = [local(Some("10.1/z"), Some("Z"), Some("K7"))];
        let plan = sync_plan(&[], &local_papers);
        assert!(plan.delete.is_empty());
        assert!(plan.push.is_empty());
        assert!(plan.pull.is_empty());
    }
}

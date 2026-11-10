//! Items of a reading-list subtree, grouped by list (36-08). The fetch stays with the caller;
//! these helpers say which lists to fetch and how the fetched items are grouped.

use serde::{Deserialize, Serialize};

use super::reading_list::{ReadingListItem, ReadingListTreeNode};

/// One list of a subtree with the items it holds, in fetch order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct SubtreeListItems {
    pub list_id: String,
    pub items: Vec<ReadingListItem>,
}

/// `subtreeIds`: the id of `node` and of every list below it, parents before children.
#[must_use]
pub fn subtree_ids(node: &ReadingListTreeNode) -> Vec<String> {
    let mut ids = vec![node.list.id.clone()];
    for child in &node.children {
        ids.extend(subtree_ids(child));
    }
    ids
}

/// The items for every list in the subtree, grouped by list. Every list in the subtree gets an
/// entry, empty when it holds nothing; the order of `items` is kept within each list. Items of
/// lists outside the subtree are dropped.
#[must_use]
pub fn group_subtree_items(
    node: &ReadingListTreeNode,
    items: &[ReadingListItem],
) -> Vec<SubtreeListItems> {
    let mut groups: Vec<SubtreeListItems> = subtree_ids(node)
        .into_iter()
        .map(|list_id| SubtreeListItems {
            list_id,
            items: Vec::new(),
        })
        .collect();
    for item in items {
        if let Some(group) = groups
            .iter_mut()
            .find(|group| group.list_id == item.list_id)
        {
            group.items.push(item.clone());
        }
    }
    groups
}

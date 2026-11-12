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

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use crate::reading_lists::reading_list::ReadingList;

    use super::*;

    fn list(id: &str) -> ReadingList {
        ReadingList {
            id: id.to_owned(),
            name: id.to_owned(),
            description: None,
            parent_id: None,
            sort_order: 0.0,
            color: None,
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        }
    }

    fn node(id: &str, children: Vec<ReadingListTreeNode>) -> ReadingListTreeNode {
        ReadingListTreeNode {
            list: list(id),
            children,
        }
    }

    fn item(id: &str, list_id: &str) -> ReadingListItem {
        ReadingListItem {
            id: id.to_owned(),
            list_id: list_id.to_owned(),
            paper_id: None,
            vault_page_id: None,
            sort_order: 0.0,
            note: None,
            inherited_from_list_id: None,
            duplicate_of_item_id: None,
        }
    }

    #[test]
    fn subtree_ids_list_parents_before_children() {
        let tree = node(
            "root",
            vec![
                node("a", vec![node("a1", Vec::new())]),
                node("b", Vec::new()),
            ],
        );
        assert_eq!(subtree_ids(&tree), vec!["root", "a", "a1", "b"]);
    }

    #[test]
    fn every_list_in_the_subtree_gets_a_group_even_when_empty() {
        let tree = node("root", vec![node("child", Vec::new())]);
        let groups = group_subtree_items(&tree, &[item("i1", "child")]);
        assert_eq!(
            groups
                .iter()
                .map(|group| group.list_id.as_str())
                .collect::<Vec<_>>(),
            vec!["root", "child"]
        );
        assert!(groups.first().is_some_and(|group| group.items.is_empty()));
        assert_eq!(groups.get(1).map(|group| group.items.len()), Some(1));
    }

    #[test]
    fn items_keep_their_order_within_each_list() {
        let tree = node("root", vec![node("child", Vec::new())]);
        let items = [item("i1", "root"), item("i2", "child"), item("i3", "root")];
        let groups = group_subtree_items(&tree, &items);
        let root_ids: Vec<&str> = groups
            .first()
            .map(|group| group.items.iter().map(|item| item.id.as_str()).collect())
            .unwrap_or_default();
        assert_eq!(root_ids, vec!["i1", "i3"]);
    }

    #[test]
    fn items_of_lists_outside_the_subtree_are_dropped() {
        let tree = node("root", Vec::new());
        let groups = group_subtree_items(&tree, &[item("i9", "other")]);
        assert_eq!(groups.len(), 1);
        assert!(groups.iter().all(|group| group.items.is_empty()));
    }
}

//! Reading-list model and nested tree. Port of
//! `packages/core/src/features/reading-lists/domain/reading-list.ts`.
//!
//! `createReadingList` is not ported: it reads a clock and draws an id, so the caller builds
//! the record. Pure.

use std::cmp::Ordering;

use crate::js_collate::locale_compare;
use crate::tree::{TreeNode, build_tree};

/// A named, nestable grouping of papers (TS `ReadingList`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReadingList {
    /// Stable id.
    pub id: String,
    /// Display name, trimmed.
    pub name: String,
    /// Free text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub description: Option<String>,
    /// Parent list id for nesting; absent = top level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub parent_id: Option<String>,
    /// Position among siblings.
    pub sort_order: f64,
    /// Display colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub color: Option<String>,
    /// Creation time, ISO 8601 UTC.
    pub created_at: String,
}

/// A paper or note membership in a list (TS `ReadingListItem`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReadingListItem {
    /// Stable id.
    pub id: String,
    /// The list this row belongs to.
    pub list_id: String,
    /// Paper id; exactly one of this and `vault_page_id` is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub paper_id: Option<String>,
    /// Vault page id; exactly one of this and `paper_id` is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub vault_page_id: Option<String>,
    /// Position among the list's items.
    pub sort_order: f64,
    /// Why this item is in this list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub note: Option<String>,
    /// Set when membership was propagated from a descendant list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub inherited_from_list_id: Option<String>,
    /// Set during screening when this item duplicates another in the same list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub duplicate_of_item_id: Option<String>,
}

/// A list with its nested children (TS `ReadingListTreeNode`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReadingListTreeNode {
    /// The list at this node.
    pub list: ReadingList,
    /// Child lists, sorted by `sort_order` then `name`.
    pub children: Vec<ReadingListTreeNode>,
}

/// Sibling order: by `sort_order`, then by `name` with `localeCompare`.
fn compare_lists(a: &ReadingList, b: &ReadingList) -> Ordering {
    a.sort_order
        .partial_cmp(&b.sort_order)
        .unwrap_or(Ordering::Equal)
        .then_with(|| locale_compare(&a.name, &b.name))
}

/// Convert the generic tree node into the list-shaped node.
fn to_list_node(node: TreeNode<ReadingList>) -> ReadingListTreeNode {
    ReadingListTreeNode {
        list: node.item,
        children: node.children.into_iter().map(to_list_node).collect(),
    }
}

/// Build the nested list tree from a flat array (TS `buildListTree`).
///
/// A list whose parent is missing or empty is a top-level node.
#[must_use]
pub fn build_list_tree(lists: &[ReadingList]) -> Vec<ReadingListTreeNode> {
    build_tree(
        lists.to_vec(),
        |list| list.id.as_str(),
        |list| list.parent_id.as_deref(),
        compare_lists,
    )
    .into_iter()
    .map(to_list_node)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(id: &str, parent: Option<&str>, sort_order: f64, name: &str) -> ReadingList {
        ReadingList {
            id: id.to_owned(),
            name: name.to_owned(),
            description: None,
            parent_id: parent.map(str::to_owned),
            sort_order,
            color: None,
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        }
    }

    fn names(nodes: &[ReadingListTreeNode]) -> Vec<String> {
        nodes
            .iter()
            .map(|node| {
                let inner = names(&node.children);
                if inner.is_empty() {
                    node.list.name.clone()
                } else {
                    format!("{}({})", node.list.name, inner.join(","))
                }
            })
            .collect()
    }

    #[test]
    fn nests_and_sorts_by_sort_order_then_name() {
        let lists = vec![
            list("b", None, 1.0, "Beta"),
            list("a", None, 0.0, "Alpha"),
            list("a2", Some("a"), 0.0, "zeta"),
            list("a1", Some("a"), 0.0, "eta"),
        ];
        assert_eq!(names(&build_list_tree(&lists)), ["Alpha(eta,zeta)", "Beta"]);
    }

    #[test]
    fn equal_sort_order_compares_names_case_blind() {
        let lists = vec![list("x", None, 0.0, "b"), list("y", None, 0.0, "A")];
        assert_eq!(names(&build_list_tree(&lists)), ["A", "b"]);
    }

    #[test]
    fn missing_or_empty_parent_is_top_level() {
        let lists = vec![
            list("x", Some("gone"), 0.0, "X"),
            list("y", Some(""), 0.0, "Y"),
        ];
        assert_eq!(names(&build_list_tree(&lists)), ["X", "Y"]);
    }

    #[test]
    fn empty_input_gives_empty_tree() {
        assert!(build_list_tree(&[]).is_empty());
    }
}

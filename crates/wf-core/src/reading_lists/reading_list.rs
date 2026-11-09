//! Reading-list model and nested tree. Port of
//! `packages/core/src/features/reading-lists/domain/reading-list.ts`.
//!
//! `createReadingList` takes its id and timestamp as arguments, so it stays pure.

use std::cmp::Ordering;

use crate::js_collate::locale_compare;
use crate::reader_analysis::lines::js_trim;
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

/// Input to [`create_reading_list`] (TS `NewReadingListInput`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct NewReadingListInput {
    /// Display name; trimmed and required. Absent or null is treated as blank.
    pub name: Option<String>,
    /// Free text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub description: Option<String>,
    /// Parent list id; absent = top level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub parent_id: Option<String>,
    /// Display colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub color: Option<String>,
    /// Position among siblings; absent = 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub sort_order: Option<f64>,
}

/// TS `createReadingList` with the id and creation time supplied by the caller.
///
/// # Errors
///
/// Returns the TS validation message when the trimmed name is empty.
pub fn create_reading_list(
    input: &NewReadingListInput,
    id: &str,
    now: &str,
) -> Result<ReadingList, String> {
    let name = input.name.as_deref().map_or("", js_trim);
    if name.is_empty() {
        return Err("Reading list name is required.".to_owned());
    }
    Ok(ReadingList {
        id: id.to_owned(),
        name: name.to_owned(),
        description: input.description.clone(),
        parent_id: input.parent_id.clone(),
        sort_order: input.sort_order.unwrap_or(0.0),
        color: input.color.clone(),
        created_at: now.to_owned(),
    })
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

    fn new_input(name: Option<&str>) -> NewReadingListInput {
        NewReadingListInput {
            name: name.map(str::to_owned),
            description: None,
            parent_id: None,
            color: None,
            sort_order: None,
        }
    }

    #[test]
    fn create_trims_name_and_defaults_sort_order() {
        let made = create_reading_list(
            &new_input(Some("  Latent spaces ")),
            "L1",
            "2026-01-01T00:00:00.000Z",
        )
        .unwrap();
        assert_eq!(made.id, "L1");
        assert_eq!(made.name, "Latent spaces");
        assert_eq!(made.sort_order, 0.0);
        assert_eq!(made.created_at, "2026-01-01T00:00:00.000Z");
    }

    #[test]
    fn create_rejects_blank_or_missing_name() {
        let message = "Reading list name is required.";
        assert_eq!(
            create_reading_list(&new_input(Some("   ")), "L", "t").unwrap_err(),
            message
        );
        assert_eq!(
            create_reading_list(&new_input(Some("")), "L", "t").unwrap_err(),
            message
        );
        assert_eq!(
            create_reading_list(&new_input(None), "L", "t").unwrap_err(),
            message
        );
    }

    #[test]
    fn create_keeps_optional_fields_as_given() {
        let mut given = new_input(Some("Child"));
        given.description = Some("  kept  ".to_owned());
        given.parent_id = Some("p".to_owned());
        given.color = Some("#fff".to_owned());
        given.sort_order = Some(3.0);
        let made = create_reading_list(&given, "c", "t").unwrap();
        assert_eq!(made.description.as_deref(), Some("  kept  "));
        assert_eq!(made.parent_id.as_deref(), Some("p"));
        assert_eq!(made.color.as_deref(), Some("#fff"));
        assert_eq!(made.sort_order, 3.0);
    }
}

//! Reading-list model and nested tree. Port of
//! `packages/core/src/features/reading-lists/domain/reading-list.ts`.
//!
//! `createReadingList` takes its id and timestamp as arguments, so it stays pure.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

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

/// The list and every list below it, deepest first: children (each subtree first) before their
/// parent (TS `removeList`'s `deepestFirst`). Children keep the order of `lists`.
#[must_use]
pub fn deepest_first_list_ids(list_id: &str, lists: &[ReadingList]) -> Vec<String> {
    let mut ids = Vec::new();
    push_deepest_first(list_id, lists, &mut ids);
    ids
}

fn push_deepest_first(id: &str, lists: &[ReadingList], ids: &mut Vec<String>) {
    for child in lists
        .iter()
        .filter(|list| list.parent_id.as_deref() == Some(id))
    {
        push_deepest_first(&child.id, lists, ids);
    }
    ids.push(id.to_owned());
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

/// Swatch for a list: its own colour when set, else a stable hue hashed from the name.
///
/// The hash walks UTF-16 code units, as the TS `charCodeAt` loop did.
#[must_use]
pub fn list_display_colour(list: &ReadingList) -> String {
    display_colour(&list.name, list.color.as_deref())
}

/// [`list_display_colour`] from a name and an optional colour, for callers that
/// hold only those two fields.
#[must_use]
pub fn display_colour(name: &str, color: Option<&str>) -> String {
    if let Some(color) = color.filter(|c| !c.is_empty()) {
        return color.to_owned();
    }
    let hue = name
        .encode_utf16()
        .fold(0_u32, |h, unit| (h * 31 + u32::from(unit)) % 360);
    format!("hsl({hue}, 48%, 58%)")
}

/// Which id on a join row names the resource a membership map is keyed by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ListMembershipKey"))]
#[serde(rename_all = "camelCase")]
pub enum MembershipKey {
    /// `paper_id` only (the papers and lists screens).
    Paper,
    /// `vault_page_id` only (the vault screen).
    VaultPage,
    /// The paper if set, else the vault page (the graph screen).
    Either,
}

/// A list item as membership sees it: the list it joins and the resource it names.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipItem {
    /// List id.
    pub list_id: String,
    /// Paper id.
    #[serde(default)]
    pub paper_id: Option<String>,
    /// Vault page id.
    #[serde(default)]
    pub vault_page_id: Option<String>,
}

/// Just the id of a list; nothing else about a list decides membership.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct MembershipList {
    /// Id.
    pub id: String,
}

impl MembershipKey {
    fn resource_of(self, item: &MembershipItem) -> Option<&str> {
        match self {
            Self::Paper => item.paper_id.as_deref(),
            Self::VaultPage => item.vault_page_id.as_deref(),
            Self::Either => item.paper_id.as_deref().or(item.vault_page_id.as_deref()),
        }
    }
}

/// Which list holds which resource (TS `buildListMembership`): each list in `lists` order
/// with the resource ids in it, first-seen order, no duplicates. Every list keeps an entry,
/// empty or not. An item naming no resource, or a list that is not there, is skipped.
#[must_use]
pub fn list_membership(
    lists: &[MembershipList],
    items: &[MembershipItem],
    key: MembershipKey,
) -> Vec<(String, Vec<String>)> {
    let mut slot: HashMap<&str, usize> = HashMap::new();
    let mut out: Vec<(String, Vec<String>)> = Vec::with_capacity(lists.len());
    for list in lists {
        let _ = slot.entry(list.id.as_str()).or_insert(out.len());
        out.push((list.id.clone(), Vec::new()));
    }
    let mut seen: Vec<HashSet<&str>> = vec![HashSet::new(); out.len()];
    for item in items {
        let Some(resource) = key.resource_of(item) else {
            continue;
        };
        let Some(&at) = slot.get(item.list_id.as_str()) else {
            continue;
        };
        if seen[at].insert(resource) {
            out[at].1.push(resource.to_owned());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepest_first_puts_children_before_their_parent() {
        let lists = [
            list("root", None, 0.0, "Root"),
            list("a", Some("root"), 0.0, "A"),
            list("a1", Some("a"), 0.0, "A1"),
            list("b", Some("root"), 1.0, "B"),
            list("other", None, 1.0, "Other"),
        ];
        assert_eq!(
            deepest_first_list_ids("root", &lists),
            vec!["a1", "a", "b", "root"]
        );
        assert_eq!(deepest_first_list_ids("other", &lists), vec!["other"]);
    }

    #[test]
    fn display_colour_prefers_the_list_colour() {
        let mut coloured = list("a", None, 0.0, "Thesis");
        coloured.color = Some("#abcdef".to_owned());
        assert_eq!(list_display_colour(&coloured), "#abcdef");
    }

    #[test]
    fn display_colour_hashes_the_name_to_a_stable_hue() {
        assert_eq!(
            list_display_colour(&list("a", None, 0.0, "Thesis")),
            "hsl(204, 48%, 58%)"
        );
        assert_eq!(
            list_display_colour(&list("b", None, 0.0, "Thesis")),
            "hsl(204, 48%, 58%)"
        );
        assert_eq!(
            list_display_colour(&list("c", None, 0.0, "")),
            "hsl(0, 48%, 58%)"
        );
    }

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

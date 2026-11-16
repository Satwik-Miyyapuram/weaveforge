//! Reading-list tree order helpers: flatten a tree to ids, reorder ids after a drag, and step
//! a list up or down (DA-78 keyboard reorder).

use std::collections::{HashMap, HashSet};

use super::reading_list::{ReadingListItem, ReadingListTreeNode};

/// `collectListIds`: every list id in the tree, parents before children, in tree order.
#[must_use]
pub fn collect_list_ids(tree: &[ReadingListTreeNode]) -> Vec<String> {
    let mut ids = Vec::new();
    collect_into(tree, &mut ids);
    ids
}

fn collect_into(nodes: &[ReadingListTreeNode], ids: &mut Vec<String>) {
    for node in nodes {
        ids.push(node.list.id.clone());
        collect_into(&node.children, ids);
    }
}

/// `reorderedIds`: `ids` with `drag_id` moved into `target_id`'s place, or `None` when nothing moves.
#[must_use]
pub fn reordered_ids(ids: &[String], drag_id: &str, target_id: &str) -> Option<Vec<String>> {
    if drag_id == target_id {
        return None;
    }
    let from = ids.iter().position(|id| id == drag_id)?;
    let to = ids.iter().position(|id| id == target_id)?;
    let mut next = ids.to_vec();
    let moved = next.remove(from);
    next.insert(to, moved);
    Some(next)
}

/// `movedIds`: `ids` with `id` moved one step (`-1` up, `1` down), or `None` at either end, for
/// any other step, or when `id` is not listed.
#[must_use]
pub fn moved_ids(ids: &[String], id: &str, step: i32) -> Option<Vec<String>> {
    let index = ids.iter().position(|candidate| candidate == id)?;
    let target = match step {
        -1 => index.checked_sub(1)?,
        1 => index + 1,
        _ => return None,
    };
    let target_id = ids.get(target)?;
    reordered_ids(ids, id, target_id)
}

/// One item whose `sort_order` must change (TS `reorderItems` write).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ItemOrderWrite {
    /// The item to move.
    pub item_id: String,
    /// Its new position.
    pub sort_order: f64,
}

/// The writes that give a list its new item order, or the message that refuses the order.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ItemOrderPlan {
    /// Why the order is refused; `None` when it is accepted.
    pub error: Option<String>,
    /// The writes, empty when refused.
    pub writes: Vec<ItemOrderWrite>,
}

/// TS `reorderItems` after the `listId` check: validates `ordered_ids` against the list's
/// `items` (count, then duplicates, then missing, first failure wins), and writes only the
/// items whose position changed.
#[must_use]
pub fn plan_item_order(
    list_id: &str,
    items: &[ReadingListItem],
    ordered_ids: &[String],
) -> ItemOrderPlan {
    if ordered_ids.len() != items.len() {
        return refused(format!(
            "orderedItemIds must include every item in list {list_id}."
        ));
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for id in ordered_ids {
        if !seen.insert(id.as_str()) {
            return refused(format!(
                "orderedItemIds contains duplicates for list {list_id}."
            ));
        }
    }
    if let Some(missing) = items.iter().find(|item| !seen.contains(item.id.as_str())) {
        return refused(format!(
            "orderedItemIds is missing item {} for list {list_id}.",
            missing.id
        ));
    }
    let by_id: HashMap<&str, &ReadingListItem> =
        items.iter().map(|item| (item.id.as_str(), item)).collect();
    let writes = ordered_ids
        .iter()
        .enumerate()
        .filter_map(|(index, id)| {
            let item = by_id.get(id.as_str())?;
            let sort_order = index as f64;
            (item.sort_order != sort_order).then(|| ItemOrderWrite {
                item_id: id.clone(),
                sort_order,
            })
        })
        .collect();
    ItemOrderPlan {
        error: None,
        writes,
    }
}

fn refused(message: String) -> ItemOrderPlan {
    ItemOrderPlan {
        error: Some(message),
        writes: Vec::new(),
    }
}

/// The item ids for a paper order, or the message that refuses it (TS `reorderPapers`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ItemIdsPlan {
    /// Why the order is refused; `None` when it is accepted.
    pub error: Option<String>,
    /// The item ids in the requested order, empty when refused.
    pub item_ids: Vec<String>,
}

/// TS `reorderPapers` lookup: the item id of each paper, in `paper_ids` order. Refuses the
/// first paper that is not in the list.
#[must_use]
pub fn item_ids_for_papers(
    list_id: &str,
    items: &[ReadingListItem],
    paper_ids: &[String],
) -> ItemIdsPlan {
    let mut item_ids = Vec::with_capacity(paper_ids.len());
    for paper_id in paper_ids {
        let found = items
            .iter()
            .find(|item| item.paper_id.as_deref() == Some(paper_id.as_str()));
        match found {
            Some(item) => item_ids.push(item.id.clone()),
            None => {
                return ItemIdsPlan {
                    error: Some(format!("Paper {paper_id} is not in list {list_id}.")),
                    item_ids: Vec::new(),
                };
            }
        }
    }
    ItemIdsPlan {
        error: None,
        item_ids,
    }
}

/// TS `addToListOne`: the sort order a new row gets after `siblings`. An empty list gives 0,
/// otherwise one past the highest existing order.
#[must_use]
pub fn next_sort_order(siblings: &[ReadingListItem]) -> f64 {
    if siblings.is_empty() {
        return 0.0;
    }
    siblings
        .iter()
        .map(|item| item.sort_order)
        .fold(f64::NEG_INFINITY, f64::max)
        + 1.0
}

/// TS `INHERITED_LINK_CODES`: the database error codes that mean only the inherited link
/// failed (source list gone, or an old schema). A plain row is worth retrying for these alone.
#[must_use]
pub fn is_inherited_link_code(code: Option<&str>) -> bool {
    matches!(code, Some("23503" | "42703" | "PGRST204"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| (*v).to_owned()).collect()
    }

    #[test]
    fn reorder_moves_drag_into_target_place() {
        assert_eq!(
            reordered_ids(&s(&["a", "b", "c"]), "a", "c"),
            Some(s(&["b", "c", "a"]))
        );
        assert_eq!(reordered_ids(&s(&["a", "b"]), "a", "a"), None);
        assert_eq!(reordered_ids(&s(&["a", "b"]), "a", "z"), None);
    }

    fn row(id: &str, sort_order: f64) -> ReadingListItem {
        ReadingListItem {
            id: id.to_owned(),
            list_id: "L".to_owned(),
            paper_id: None,
            vault_page_id: None,
            sort_order,
            note: None,
            inherited_from_list_id: None,
            duplicate_of_item_id: None,
        }
    }

    #[test]
    fn plan_writes_only_the_items_that_moved() {
        let items = [row("a", 0.0), row("b", 1.0), row("c", 2.0)];
        let plan = plan_item_order("L", &items, &s(&["b", "a", "c"]));
        assert_eq!(plan.error, None);
        assert_eq!(
            plan.writes,
            vec![
                ItemOrderWrite {
                    item_id: "b".to_owned(),
                    sort_order: 0.0
                },
                ItemOrderWrite {
                    item_id: "a".to_owned(),
                    sort_order: 1.0
                },
            ]
        );
    }

    #[test]
    fn plan_refuses_a_short_duplicated_or_incomplete_order() {
        let items = [row("a", 0.0), row("b", 1.0), row("c", 2.0)];
        let short = plan_item_order("L", &items, &s(&["a", "b"]));
        assert_eq!(
            short.error.as_deref(),
            Some("orderedItemIds must include every item in list L.")
        );
        let duplicated = plan_item_order("L", &items, &s(&["a", "a", "c"]));
        assert_eq!(
            duplicated.error.as_deref(),
            Some("orderedItemIds contains duplicates for list L.")
        );
        let missing = plan_item_order("L", &items, &s(&["a", "b", "z"]));
        assert_eq!(
            missing.error.as_deref(),
            Some("orderedItemIds is missing item c for list L.")
        );
        assert!(missing.writes.is_empty());
    }

    #[test]
    fn step_stops_at_the_ends() {
        let ids = s(&["a", "b", "c"]);
        assert_eq!(moved_ids(&ids, "a", -1), None);
        assert_eq!(moved_ids(&ids, "c", 1), None);
        assert_eq!(moved_ids(&ids, "b", -1), Some(s(&["b", "a", "c"])));
        assert_eq!(moved_ids(&ids, "b", 1), Some(s(&["a", "c", "b"])));
        assert_eq!(moved_ids(&ids, "b", 2), None);
        assert_eq!(moved_ids(&ids, "z", 1), None);
    }

    #[test]
    fn paper_order_maps_each_paper_to_its_item() {
        let mut first = row("i1", 0.0);
        first.paper_id = Some("p1".to_owned());
        let mut second = row("i2", 1.0);
        second.paper_id = Some("p2".to_owned());
        let items = [first, second];
        let plan = item_ids_for_papers("L", &items, &s(&["p2", "p1"]));
        assert_eq!(plan.error, None);
        assert_eq!(plan.item_ids, s(&["i2", "i1"]));
    }

    #[test]
    fn paper_order_refuses_the_first_paper_not_in_the_list() {
        let mut only = row("i1", 0.0);
        only.paper_id = Some("p1".to_owned());
        let plan = item_ids_for_papers("L", &[only], &s(&["p1", "p9", "p8"]));
        assert_eq!(plan.error.as_deref(), Some("Paper p9 is not in list L."));
        assert!(plan.item_ids.is_empty());
    }

    #[test]
    fn next_sort_order_is_zero_then_one_past_the_highest() {
        assert_eq!(next_sort_order(&[]), 0.0);
        let rows = [row("a", 0.0), row("b", 4.0), row("c", 2.0)];
        assert_eq!(next_sort_order(&rows), 5.0);
    }

    #[test]
    fn only_the_three_inherited_link_codes_count() {
        assert!(is_inherited_link_code(Some("23503")));
        assert!(is_inherited_link_code(Some("42703")));
        assert!(is_inherited_link_code(Some("PGRST204")));
        assert!(!is_inherited_link_code(Some("23505")));
        assert!(!is_inherited_link_code(None));
    }
}

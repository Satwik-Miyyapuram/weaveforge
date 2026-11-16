//! The `reading_list_items` repository as Rust-planned queries.
//!
//! Ported from `PostgrestReadingListItemRepository` in
//! `apps/web/src/features/reading-lists/infrastructure/parts.ts`. The row mapping is
//! [`crate::reading_lists::list_row`]. Items carry no project, so no method is project-scoped.

use serde_json::json;

use crate::reading_lists::list_row::{ReadingListItemRow, to_item_domain, to_item_row};
use crate::reading_lists::reading_list::ReadingListItem;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "reading_list_items";

/// The columns a [`ReadingListItemRow`] is read as, named rather than starred.
pub const READING_LIST_ITEM_COLUMNS: &str =
    "id,list_id,paper_id,vault_page_id,sort_order,note,inherited_from_list_id,duplicate_of_item_id";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "listItems" => list_items(call),
        "listItemsForLists" => list_items_for_lists(call),
        "listsForPaper" => lists_for_paper(call),
        "listsForNote" => lists_for_note(call),
        "find" => find(call),
        "findNote" => find_note(call),
        "add" => add(call),
        "remove" => remove(call),
        _ => return None,
    })
}

fn select() -> RepoQuery {
    RepoQuery::select(TABLE, READING_LIST_ITEM_COLUMNS)
}

/// `listItems(listId)`: the list's items by sort order.
fn list_items(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            select()
                .eq("list_id", call.text(0))
                .order("sort_order", true),
        );
    }
    map_rows(call, 0, to_item_domain)
}

/// `listItemsForLists(listIds)`: the items of several lists by sort order; `[]` sends nothing.
fn list_items_for_lists(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let ids: Vec<String> = match call.parse(0) {
            Ok(ids) => ids,
            Err(e) => return RepoStep::fail(e),
        };
        if ids.is_empty() {
            return RepoStep::done(&Vec::<ReadingListItem>::new());
        }
        return RepoStep::send(
            select()
                .filter("in", "list_id", json!(ids))
                .order("sort_order", true),
        );
    }
    map_rows(call, 0, to_item_domain)
}

/// `listsForPaper(paperId)`: every membership of a paper, unordered.
fn lists_for_paper(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(select().eq("paper_id", call.text(0)));
    }
    map_rows(call, 0, to_item_domain)
}

/// `listsForNote(vaultPageId)`: every membership of a note, unordered.
fn lists_for_note(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(select().eq("vault_page_id", call.text(0)));
    }
    map_rows(call, 0, to_item_domain)
}

/// `find(listId, paperId)`: the item, or `null`.
fn find(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            select()
                .eq("list_id", call.text(0))
                .eq("paper_id", call.text(1))
                .maybe_single(),
        );
    }
    maybe_item(call)
}

/// `findNote(listId, vaultPageId)`: the note's item, or `null`.
fn find_note(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            select()
                .eq("list_id", call.text(0))
                .eq("vault_page_id", call.text(1))
                .maybe_single(),
        );
    }
    maybe_item(call)
}

/// Reply 0 as one item or `null`.
fn maybe_item(call: &RepoCall) -> RepoStep {
    map_row(call, 0, |row: &Option<ReadingListItemRow>| {
        row.as_ref().map(to_item_domain)
    })
}

/// `add(item)`: upsert, without a project stamp, as in TS.
fn add(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let item: ReadingListItem = match call.parse(0) {
        Ok(item) => item,
        Err(e) => return RepoStep::fail(e),
    };
    match serde_json::to_value(to_item_row(&item)) {
        Ok(row) => RepoStep::send(RepoQuery::upsert(TABLE, row)),
        Err(e) => RepoStep::fail(e),
    }
}

/// `remove(id)`.
fn remove(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};
    use serde_json::Value;

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx::default(),
        }
    }

    fn sent(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } => queries.remove(0),
            other => panic!("expected send, got {other:?}"),
        }
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    fn item_row(id: &str, list: &str, paper: Option<&str>) -> Value {
        json!({ "id": id, "list_id": list, "paper_id": paper, "vault_page_id": null,
            "sort_order": 0, "note": null, "inherited_from_list_id": null,
            "duplicate_of_item_id": null })
    }

    #[test]
    fn list_items_reads_the_list_by_sort_order_and_maps_rows() {
        let q = sent(list_items(&call(vec![json!("l1")], vec![])));
        assert_eq!(q.filters[0].column, "list_id");
        assert_eq!(q.order[0].column, "sort_order");
        assert!(q.order[0].ascending);
        let v = done(list_items(&call(
            vec![json!("l1")],
            vec![json!([item_row("i1", "l1", Some("p1"))])],
        )));
        assert_eq!(v[0]["paperId"], "p1");
        assert!(v[0].get("vaultPageId").is_none());
        assert!(v[0].get("inheritedFromListId").is_none());
    }

    #[test]
    fn list_items_for_lists_with_no_ids_sends_nothing() {
        assert_eq!(
            done(list_items_for_lists(&call(vec![json!([])], vec![]))),
            json!([])
        );
    }

    #[test]
    fn list_items_for_lists_filters_in_the_given_lists() {
        let q = sent(list_items_for_lists(&call(
            vec![json!(["l1", "l2"])],
            vec![],
        )));
        assert_eq!(q.filters[0].op, "in");
        assert_eq!(q.filters[0].value, json!(["l1", "l2"]));
        assert_eq!(q.order[0].column, "sort_order");
    }

    #[test]
    fn lists_for_paper_and_note_filter_by_their_column() {
        let q = sent(lists_for_paper(&call(vec![json!("p1")], vec![])));
        assert_eq!(q.filters[0].column, "paper_id");
        assert!(q.order.is_empty());
        let q = sent(lists_for_note(&call(vec![json!("v1")], vec![])));
        assert_eq!(q.filters[0].column, "vault_page_id");
        assert_eq!(q.filters[0].value, json!("v1"));
    }

    #[test]
    fn find_reads_one_membership_or_null() {
        let q = sent(find(&call(vec![json!("l1"), json!("p1")], vec![])));
        assert_eq!(q.single, RepoSingle::Maybe);
        assert_eq!(q.filters.len(), 2);
        assert_eq!(
            done(find(&call(
                vec![json!("l1"), json!("p1")],
                vec![Value::Null]
            ))),
            Value::Null
        );
        let row = item_row("i1", "l1", Some("p1"));
        assert_eq!(
            done(find(&call(vec![json!("l1"), json!("p1")], vec![row])))["id"],
            "i1"
        );
    }

    #[test]
    fn find_note_matches_the_note_column() {
        let q = sent(find_note(&call(vec![json!("l1"), json!("v1")], vec![])));
        assert_eq!(q.filters[1].column, "vault_page_id");
        assert_eq!(q.single, RepoSingle::Maybe);
        assert_eq!(
            done(find_note(&call(
                vec![json!("l1"), json!("v1")],
                vec![Value::Null]
            ))),
            Value::Null
        );
    }

    #[test]
    fn add_upserts_and_drops_empty_inherited_ids() {
        let item = json!({ "id": "i1", "listId": "l1", "paperId": "p1", "sortOrder": 0,
            "inheritedFromListId": "" });
        let q = sent(add(&call(vec![item.clone()], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.unwrap();
        assert_eq!(body["list_id"], "l1");
        assert!(body.get("inherited_from_list_id").is_none());
        let item =
            json!({ "id": "i1", "listId": "l1", "sortOrder": 0, "inheritedFromListId": "l0" });
        assert_eq!(
            sent(add(&call(vec![item.clone()], vec![]))).body.unwrap()["inherited_from_list_id"],
            "l0"
        );
        assert_eq!(done(add(&call(vec![item], vec![Value::Null]))), Value::Null);
    }

    #[test]
    fn remove_deletes_the_id_then_unit() {
        let q = sent(step("remove", &call(vec![json!("i1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(
            done(remove(&call(vec![json!("i1")], vec![Value::Null]))),
            Value::Null
        );
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}

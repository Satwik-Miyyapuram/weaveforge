//! The `reading_lists` repository as Rust-planned queries.
//!
//! Ported from `PostgrestReadingListRepository` in
//! `apps/web/src/features/reading-lists/infrastructure/parts.ts`. The row mapping is
//! [`crate::reading_lists::list_row`] and the tree is [`build_list_tree`]. `nameContains`
//! is matched here on the rows the query returns, as the TS does, because names are
//! encrypted at rest and the server cannot match them.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::reading_lists::list_row::{ReadingListRow, to_list_domain, to_list_row};
use crate::reading_lists::name_filter::name_contains;
use crate::reading_lists::reading_list::{ReadingList, build_list_tree};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row};

const TABLE: &str = "reading_lists";

/// Ids per `in` query; keeps the URL under the server's line-length limit (TS `ID_CHUNK`).
const ID_CHUNK: usize = 200;

/// The columns a [`ReadingListRow`] is read as, named rather than starred.
pub const READING_LIST_COLUMNS: &str = "id,name,description,parent_id,sort_order,color,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "listByIds" => list_by_ids(call),
        "list" => list(call),
        "getTree" => get_tree(call),
        "save" => save(call),
        "delete" => delete(call),
        _ => return None,
    })
}

/// `ReadingListFilter`. `parentId: null` means top level; an absent `parentId` means any parent.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Filter {
    #[serde(default, deserialize_with = "present")]
    parent_id: Option<Option<String>>,
}

/// Keeps an explicit `null` apart from an absent field.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

/// The project's lists by sort order, then name, narrowed by the parent filter.
fn list_select(call: &RepoCall, filter: &Filter) -> RepoQuery {
    let mut q = RepoQuery::select(TABLE, READING_LIST_COLUMNS);
    if let Some(pid) = call.ctx.project_id.as_deref() {
        q = q.eq("project_id", pid);
    }
    match &filter.parent_id {
        Some(Some(parent)) => q = q.eq("parent_id", parent.as_str()),
        Some(None) => q = q.filter("is", "parent_id", Value::Null),
        None => {}
    }
    q.order("sort_order", true).order("name", true)
}

/// `getById(id)`: the list, or `null`. Not scoped to the project, as in TS.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, READING_LIST_COLUMNS)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<ReadingListRow>| {
        row.as_ref().map(to_list_domain)
    })
}

/// `listByIds(ids)`: lists by id, in chunks issued together; not scoped to the project.
fn list_by_ids(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let ids: Vec<String> = match call.parse(0) {
            Ok(ids) => ids,
            Err(e) => return RepoStep::fail(e),
        };
        if ids.is_empty() {
            return RepoStep::done(&Vec::<ReadingList>::new());
        }
        return RepoStep::Send {
            queries: ids
                .chunks(ID_CHUNK)
                .map(|chunk| {
                    RepoQuery::select(TABLE, READING_LIST_COLUMNS)
                        .filter("in", "id", json!(chunk))
                        .order("id", true)
                })
                .collect(),
        };
    }
    let mut found = Vec::new();
    for i in 0..call.replies.len() {
        match call.reply::<Vec<ReadingListRow>>(i) {
            Some(Ok(rows)) => found.extend(rows.iter().map(to_list_domain)),
            Some(Err(e)) => return RepoStep::fail(e),
            None => return RepoStep::fail(format!("reply {i} missing")),
        }
    }
    RepoStep::done(&found)
}

/// `list(filter?)`: the project's lists, then matched on `nameContains`.
fn list(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let filter: Filter = if call.arg(0).is_null() {
            Filter::default()
        } else {
            match call.parse(0) {
                Ok(f) => f,
                Err(e) => return RepoStep::fail(e),
            }
        };
        return RepoStep::send(list_select(call, &filter));
    }
    let needle = match call.arg(0) {
        Value::Object(map) => map
            .get("nameContains")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        _ => String::new(),
    };
    match call.reply::<Vec<ReadingListRow>>(0) {
        Some(Ok(rows)) => {
            let found: Vec<ReadingList> = rows
                .iter()
                .map(to_list_domain)
                .filter(|list| name_contains(&list.name, &needle))
                .collect();
            RepoStep::done(&found)
        }
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `getTree()`: the project's lists, nested by parent.
fn get_tree(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(list_select(call, &Filter::default()));
    }
    match call.reply::<Vec<ReadingListRow>>(0) {
        Some(Ok(rows)) => {
            let lists: Vec<ReadingList> = rows.iter().map(to_list_domain).collect();
            RepoStep::done(&build_list_tree(&lists))
        }
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `save(list)`: upsert, stamped with the open project when there is one.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let list: ReadingList = match call.parse(0) {
        Ok(list) => list,
        Err(e) => return RepoStep::fail(e),
    };
    let mut row = match serde_json::to_value(to_list_row(&list)) {
        Ok(row) => row,
        Err(e) => return RepoStep::fail(e),
    };
    if let (Some(pid), Value::Object(map)) = (call.ctx.project_id.as_deref(), &mut row) {
        let _ = map.insert("project_id".into(), json!(pid));
    }
    RepoStep::send(RepoQuery::upsert(TABLE, row))
}

/// `delete(id)`.
fn delete(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                ..RepoCtx::default()
            },
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

    fn list_row(id: &str, name: &str, parent: Option<&str>, sort: f64) -> Value {
        json!({ "id": id, "name": name, "description": null, "parent_id": parent,
            "sort_order": sort, "color": null, "created_at": "2026-11-01T10:00:00Z" })
    }

    #[test]
    fn list_is_project_scoped_and_ordered_by_sort_then_name() {
        let q = sent(list(&call(vec![], vec![])));
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.order[0].column, "sort_order");
        assert!(q.order[0].ascending);
        assert_eq!(q.order[1].column, "name");
    }

    #[test]
    fn list_without_a_project_is_unscoped() {
        let mut c = call(vec![], vec![]);
        c.ctx.project_id = None;
        assert!(sent(list(&c)).filters.is_empty());
    }

    #[test]
    fn list_filters_parent_then_matches_names_after_the_read() {
        let q = sent(list(&call(vec![json!({ "parentId": null })], vec![])));
        assert_eq!(q.filters[1].op, "is");
        assert_eq!(q.filters[1].value, Value::Null);
        let rows = json!([
            list_row("a", "Alpha", None, 0.0),
            list_row("b", "Beta", None, 1.0)
        ]);
        let v = done(list(&call(
            vec![json!({ "nameContains": "ALP" })],
            vec![rows],
        )));
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["id"], "a");
        assert_eq!(v[0]["createdAt"], "2026-11-01T10:00:00Z");
        assert!(v[0].get("parentId").is_none());
    }

    #[test]
    fn get_by_id_reads_one_unscoped_row_or_null() {
        let q = sent(get_by_id(&call(vec![json!("l1")], vec![])));
        assert_eq!(q.single, RepoSingle::Maybe);
        assert!(q.filters.iter().all(|f| f.column != "project_id"));
        assert_eq!(
            done(get_by_id(&call(vec![json!("l1")], vec![Value::Null]))),
            Value::Null
        );
        let row = list_row("l1", "Reading", None, 0.0);
        assert_eq!(
            done(get_by_id(&call(vec![json!("l1")], vec![row])))["id"],
            "l1"
        );
    }

    #[test]
    fn list_by_ids_with_no_ids_sends_nothing() {
        let v = done(list_by_ids(&call(vec![json!([])], vec![])));
        assert_eq!(v, json!([]));
    }

    #[test]
    fn list_by_ids_splits_into_chunks_sent_together() {
        let ids: Vec<String> = (0..201).map(|i| format!("l{i}")).collect();
        let RepoStep::Send { queries } = list_by_ids(&call(vec![json!(ids)], vec![])) else {
            panic!("expected send");
        };
        let sizes: Vec<usize> = queries
            .iter()
            .map(|q| q.filters[0].value.as_array().unwrap().len())
            .collect();
        assert_eq!(sizes, [200, 1]);
        assert_eq!(queries[0].filters[0].op, "in");
    }

    #[test]
    fn list_by_ids_joins_chunk_replies_in_order() {
        let replies = vec![
            json!([list_row("a", "A", None, 0.0)]),
            json!([list_row("b", "B", None, 0.0)]),
        ];
        let v = done(list_by_ids(&call(vec![json!(["a", "b"])], replies)));
        assert_eq!(v.as_array().unwrap().len(), 2);
        assert_eq!(v[1]["id"], "b");
    }

    #[test]
    fn get_tree_nests_children_under_parents() {
        let q = sent(get_tree(&call(vec![], vec![])));
        assert_eq!(q.filters[0].column, "project_id");
        let rows = json!([
            list_row("c", "Child", Some("p"), 1.0),
            list_row("p", "Parent", None, 0.0)
        ]);
        let v = done(get_tree(&call(vec![], vec![rows])));
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["list"]["id"], "p");
        assert_eq!(v[0]["children"][0]["list"]["id"], "c");
    }

    #[test]
    fn save_upserts_stamped_with_the_project_then_unit() {
        let list_json = json!({ "id": "l1", "name": "Reading", "sortOrder": 0,
            "createdAt": "2026-11-01T10:00:00Z" });
        let q = sent(save(&call(vec![list_json.clone()], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.unwrap();
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["description"], Value::Null);
        assert_eq!(body["sort_order"], 0.0);
        assert_eq!(
            done(save(&call(vec![list_json], vec![Value::Null]))),
            Value::Null
        );
    }

    #[test]
    fn save_without_a_project_writes_no_project_id() {
        let list_json = json!({ "id": "l1", "name": "Reading", "sortOrder": 0,
            "createdAt": "2026-11-01T10:00:00Z" });
        let mut c = call(vec![list_json], vec![]);
        c.ctx.project_id = None;
        assert!(sent(save(&c)).body.unwrap().get("project_id").is_none());
    }

    #[test]
    fn delete_targets_the_id_then_unit() {
        let q = sent(step("delete", &call(vec![json!("l1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(
            done(delete(&call(vec![json!("l1")], vec![Value::Null]))),
            Value::Null
        );
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}

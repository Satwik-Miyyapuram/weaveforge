//! The `paper_relations` repository as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/relations/infrastructure/postgrest-paper-relation-repository.ts`.
//! Row mapping is `relations::paper_relation`; the both-sides dedupe is `relations::relation_rows`.
//! Only `save` and `delete` are scoped by `project_id` on write; `findEdge` and `getById` are not
//! project-filtered, matching the TS.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::relations::paper_relation::{
    PaperRelation, PaperRelationRow, paper_relation_from_row, paper_relation_to_row,
};
use crate::relations::relation_rows::dedupe_relation_rows_by_id;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_rows};

const TABLE: &str = "paper_relations";

/// The columns a [`PaperRelationRow`] is read as, named rather than starred.
pub const PAPER_RELATION_COLUMNS: &str = "id,from_paper,to_paper,relation,note,source,created_at";

/// The optional `list` filter; an empty string means "no filter".
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListFilter {
    relation: Option<String>,
    from_paper: Option<String>,
    to_paper: Option<String>,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "list" => list(call),
        "getGraph" => get_graph(call),
        "relationsFor" => relations_for(call),
        "findEdge" => find_edge(call),
        "save" => save(call),
        "delete" => delete(call),
        _ => return None,
    })
}

/// The selected project, when non-empty (TS `if (this.pid)`).
fn project_id(call: &RepoCall) -> Option<&str> {
    call.ctx.project_id.as_deref().filter(|id| !id.is_empty())
}

/// Adds the `project_id` filter when a project is selected.
fn project_scoped(query: RepoQuery, call: &RepoCall) -> RepoQuery {
    match project_id(call) {
        Some(pid) => query.eq("project_id", pid),
        None => query,
    }
}

fn to_domain(row: &PaperRelationRow) -> PaperRelation {
    paper_relation_from_row(row.clone())
}

/// One row mapped to a relation, or `null` when the reply is `null` or missing.
fn maybe_row(call: &RepoCall, i: usize) -> RepoStep {
    if matches!(call.replies.get(i), None | Some(Value::Null)) {
        return RepoStep::unit();
    }
    match call.reply::<PaperRelationRow>(i) {
        Some(Ok(row)) => RepoStep::done(&to_domain(&row)),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail(format!("reply {i} missing")),
    }
}

/// `getById(id)`: the relation, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, "*")
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    maybe_row(call, 0)
}

/// `list(filter)`: oldest first, filtered by project and the given fields.
fn list(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let filter = match call.parse::<Option<ListFilter>>(0) {
            Ok(filter) => filter.unwrap_or_default(),
            Err(e) => return RepoStep::fail(e),
        };
        let mut query = project_scoped(RepoQuery::select(TABLE, PAPER_RELATION_COLUMNS), call);
        for (column, value) in [
            ("relation", filter.relation),
            ("from_paper", filter.from_paper),
            ("to_paper", filter.to_paper),
        ] {
            if let Some(value) = value.filter(|v| !v.is_empty()) {
                query = query.eq(column, value);
            }
        }
        return RepoStep::send(query.order("created_at", true));
    }
    map_rows(call, 0, to_domain)
}

/// `getGraph()`: every relation of the project.
fn get_graph(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(project_scoped(
            RepoQuery::select(TABLE, PAPER_RELATION_COLUMNS),
            call,
        ));
    }
    map_rows(call, 0, to_domain)
}

/// `relationsFor(paperId)`: both sides as two bound `eq` filters, sent together and deduped by
/// id so a relation on both sides of the paper appears once.
fn relations_for(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let paper = call.text(0);
        let side = |column: &str| {
            project_scoped(
                RepoQuery::select(TABLE, PAPER_RELATION_COLUMNS).eq(column, paper),
                call,
            )
        };
        return RepoStep::Send {
            queries: vec![side("from_paper"), side("to_paper")],
        };
    }
    let mut rows = Vec::new();
    for i in 0..2 {
        match call.reply::<Vec<PaperRelationRow>>(i) {
            Some(Ok(batch)) => rows.extend(batch),
            Some(Err(e)) => return RepoStep::fail(e),
            None => return RepoStep::fail(format!("reply {i} missing")),
        }
    }
    let relations: Vec<PaperRelation> = dedupe_relation_rows_by_id(rows)
        .iter()
        .map(to_domain)
        .collect();
    RepoStep::done(&relations)
}

/// `findEdge(fromPaper, toPaper, relation)`: the relation, or `null`. Not project-filtered.
fn find_edge(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, PAPER_RELATION_COLUMNS)
                .eq("from_paper", call.text(0))
                .eq("to_paper", call.text(1))
                .eq("relation", call.text(2))
                .maybe_single(),
        );
    }
    maybe_row(call, 0)
}

/// `save(entity)`: upsert on the edge key, scoped to the selected project when there is one.
fn save(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let entity: PaperRelation = match call.parse(0) {
            Ok(entity) => entity,
            Err(e) => return RepoStep::fail(e),
        };
        let mut body = match serde_json::to_value(paper_relation_to_row(entity)) {
            Ok(body) => body,
            Err(e) => return RepoStep::fail(e),
        };
        if let Some(pid) = project_id(call) {
            body["project_id"] = json!(pid);
        }
        return RepoStep::send(
            RepoQuery::upsert(TABLE, body).on_conflict("from_paper,to_paper,relation", false),
        );
    }
    RepoStep::unit()
}

/// `delete(id)`: removes the row by id.
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
            ..RepoCall::default()
        }
    }

    fn scoped(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                user_id: None,
                now: None,
                id_seed: None,
            },
        }
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn row_with(id: &str, from: &str, to: &str) -> Value {
        json!({
            "id": id, "from_paper": from, "to_paper": to, "relation": "cites",
            "note": null, "source": "manual", "created_at": "2026-01-01T00:00:00.000Z"
        })
    }

    fn row() -> Value {
        row_with("r1", "a", "b")
    }

    #[test]
    fn get_by_id_selects_all_columns_by_id_maybe_single() {
        let q = only(step("getById", &call(vec![json!("r1")], vec![])).unwrap());
        assert_eq!(q.table, "paper_relations");
        assert_eq!(q.columns.as_deref(), Some("*"));
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(q.filters[0].value, json!("r1"));
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn get_by_id_maps_row_and_null_when_missing() {
        let s = step("getById", &call(vec![], vec![row()])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["fromPaper"], "a");
        assert!(value.get("note").is_none());
        let none = step("getById", &call(vec![], vec![Value::Null])).unwrap();
        assert_eq!(none, RepoStep::unit());
    }

    #[test]
    fn list_filters_orders_oldest_first() {
        let args = vec![json!({"relation": "cites", "fromPaper": "a"})];
        let q = only(step("list", &call(args, vec![])).unwrap());
        assert_eq!(q.columns.as_deref(), Some(PAPER_RELATION_COLUMNS));
        assert_eq!(q.filters[0].column, "relation");
        assert_eq!(q.filters[1].column, "from_paper");
        assert_eq!(q.filters.len(), 2);
        assert!(q.order[0].ascending);
        assert_eq!(q.order[0].column, "created_at");
    }

    #[test]
    fn list_skips_empty_and_missing_filters_and_scopes_to_project() {
        let q = only(step("list", &scoped(vec![json!({"toPaper": ""})], vec![])).unwrap());
        assert_eq!(q.filters.len(), 1);
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[0].value, json!("p1"));
        let bare = only(step("list", &call(vec![], vec![])).unwrap());
        assert!(bare.filters.is_empty());
    }

    #[test]
    fn list_maps_rows() {
        let s = step("list", &call(vec![], vec![json!([row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["toPaper"], "b");
    }

    #[test]
    fn list_fails_on_bad_row() {
        let s = step("list", &call(vec![], vec![json!([{"id": 1}])])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn get_graph_scopes_to_project_without_order() {
        let q = only(step("getGraph", &scoped(vec![], vec![])).unwrap());
        assert_eq!(q.filters[0].column, "project_id");
        assert!(q.order.is_empty());
        let s = step("getGraph", &call(vec![], vec![json!([row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["id"], "r1");
    }

    #[test]
    fn relations_for_sends_both_sides_together() {
        let s = step("relationsFor", &scoped(vec![json!("a")], vec![])).unwrap();
        let RepoStep::Send { queries } = s else {
            panic!("{s:?}")
        };
        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0].filters[0].column, "from_paper");
        assert_eq!(queries[1].filters[0].column, "to_paper");
        assert_eq!(queries[1].filters[0].value, json!("a"));
        assert_eq!(queries[1].filters[1].column, "project_id");
    }

    #[test]
    fn relations_for_dedupes_by_id_keeping_first_position() {
        let both = vec![
            json!([row_with("r1", "a", "b")]),
            json!([row_with("r1", "a", "b"), row_with("r2", "c", "a")]),
        ];
        let s = step("relationsFor", &call(vec![json!("a")], both)).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value.as_array().map(Vec::len), Some(2));
        assert_eq!(value[0]["id"], "r1");
        assert_eq!(value[1]["id"], "r2");
    }

    #[test]
    fn find_edge_matches_three_fields_without_project_filter() {
        let args = vec![json!("a"), json!("b"), json!("cites")];
        let q = only(step("findEdge", &scoped(args, vec![])).unwrap());
        assert_eq!(q.filters.len(), 3);
        assert_eq!(q.filters[2].value, json!("cites"));
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn find_edge_maps_row_or_null() {
        let s = step("findEdge", &call(vec![], vec![row()])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["relation"], "cites");
        let none = step("findEdge", &call(vec![], vec![Value::Null])).unwrap();
        assert_eq!(none, RepoStep::unit());
    }

    #[test]
    fn save_upserts_on_edge_key_with_project() {
        let input = json!({
            "id": "r1", "fromPaper": "a", "toPaper": "b", "relation": "cites",
            "source": "manual", "createdAt": "2026-01-01T00:00:00.000Z"
        });
        let q = only(step("save", &scoped(vec![input], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(
            q.on_conflict.as_deref(),
            Some("from_paper,to_paper,relation")
        );
        assert!(!q.ignore_duplicates);
        let body = q.body.unwrap();
        assert_eq!(body["from_paper"], "a");
        assert_eq!(body["project_id"], "p1");
    }

    #[test]
    fn save_omits_project_without_one() {
        let input = json!({
            "id": "r1", "fromPaper": "a", "toPaper": "b", "relation": "cites",
            "source": "auto", "createdAt": "2026-01-01T00:00:00.000Z"
        });
        let q = only(step("save", &call(vec![input], vec![])).unwrap());
        assert!(q.body.unwrap().get("project_id").is_none());
    }

    #[test]
    fn save_rejects_bad_input_and_finishes_unit() {
        let s = step("save", &call(vec![json!({"id": 1})], vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
        assert_eq!(
            step("save", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn delete_by_id_then_finishes() {
        let q = only(step("delete", &call(vec![json!("r1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].value, json!("r1"));
        assert_eq!(
            step("delete", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}

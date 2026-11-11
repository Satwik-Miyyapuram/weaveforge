//! The shared-with-me reads as Rust-planned queries (`shared_items`).
//!
//! Ported from `PostgrestSharedReader.read` in
//! `apps/web/src/backend/providers/postgrest/wire-postgrest-backend.ts`. The table, columns and
//! filter come from [`shared_read_plan`]; rows map with [`shared_item`].

use serde_json::Value;

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_rows};
use crate::sharing::{
    ShareableType, SharedSource, shared_item, shared_read_plan, shared_table_source,
};

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "read" => read(call),
        _ => return None,
    })
}

/// `read(kind, ids, owners)`: the rows behind per-item (`ids`) and blanket (`owners`) grants;
/// `[]` when there are neither, so no request is made.
fn read(call: &RepoCall) -> RepoStep {
    let kind = match call.parse::<ShareableType>(0) {
        Ok(kind) => kind,
        Err(e) => return RepoStep::fail(e),
    };
    let ids = match call.parse::<Vec<String>>(1) {
        Ok(ids) => ids,
        Err(e) => return RepoStep::fail(e),
    };
    let owners = match call.parse::<Vec<String>>(2) {
        Ok(owners) => owners,
        Err(e) => return RepoStep::fail(e),
    };
    if !call.replies.is_empty() {
        let (_, title, status) = shared_table_source(kind);
        let source = SharedSource {
            title: title.to_owned(),
            status: status.map(str::to_owned),
        };
        return map_rows(call, 0, |row: &Value| shared_item(kind, row, &source));
    }
    match shared_read_plan(kind, &ids, &owners) {
        Some(plan) => RepoStep::send(RepoQuery::select(&plan.table, &plan.columns).filter(
            "or",
            "",
            plan.filter,
        )),
        None => RepoStep::done(&Vec::<Value>::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};
    use serde_json::json;

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

    #[test]
    fn read_selects_the_plan_table_columns_and_or_filter() {
        let args = vec![json!("paper"), json!(["p1"]), json!(["u1"])];
        let q = sent(read(&call(args, vec![])));
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.table, "papers");
        assert_eq!(
            q.columns.as_deref(),
            Some("id, title, status, user_id, metadata")
        );
        assert_eq!(q.filters[0].op, "or");
        assert_eq!(q.filters[0].value, json!("id.in.(p1),user_id.in.(u1)"));
    }

    #[test]
    fn read_without_ids_or_owners_makes_no_request() {
        let args = vec![json!("milestone"), json!([]), json!([])];
        assert_eq!(done(read(&call(args, vec![]))), json!([]));
    }

    #[test]
    fn read_maps_rows_to_shared_items_with_metadata_only_for_papers() {
        let paper = json!([{ "id": "p1", "title": "T", "status": "reading", "user_id": "u1",
            "metadata": { "doi": "x" } }]);
        let v = done(read(&call(
            vec![json!("paper"), json!(["p1"]), json!([])],
            vec![paper],
        )));
        assert_eq!(
            v,
            json!([{ "id": "p1", "kind": "paper", "title": "T", "status": "reading",
                "ownerId": "u1", "metadata": { "doi": "x" } }])
        );
        let milestone = json!([{ "id": "m1", "title": null, "status": null, "user_id": "u1",
            "metadata": { "doi": "x" } }]);
        let v = done(read(&call(
            vec![json!("milestone"), json!(["m1"]), json!([])],
            vec![milestone],
        )));
        assert_eq!(
            v,
            json!([{ "id": "m1", "kind": "milestone", "title": "(untitled)", "status": "",
                "ownerId": "u1" }])
        );
    }

    #[test]
    fn read_without_a_kind_fails() {
        let step = read(&call(vec![json!("nope"), json!([]), json!([])], vec![]));
        assert!(matches!(step, RepoStep::Fail { .. }));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("list", &call(vec![], vec![])).is_none());
    }
}

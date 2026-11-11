//! The `milestones` repository as Rust-planned queries (TS `SpecRepository` over the `milestones`
//! row spec in `backend/providers/postgrest/parts-1.ts`, wired in `wire-postgrest-backend.ts`).
//! Row mapping is `plan::milestone_row`. Writes stamp the selected project; reads by id do not.

use serde::Deserialize;
use serde_json::Value;

use crate::plan::milestone::Milestone;
use crate::plan::milestone_row::{MilestoneRow, to_milestone, to_row};
use crate::postgrest_spec::MILESTONE_COLUMNS;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "milestones";

/// `MilestoneFilter` as the list reads it. Only `status` is applied; other keys are ignored.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Filter {
    #[serde(default)]
    status: Option<String>,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "list" => list(call),
        "save" => save(call),
        "delete" => delete(call),
        _ => return None,
    })
}

/// `getById(id)`: the milestone, or `null`. Reads every column, as `rowById` does.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, "*")
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<MilestoneRow>| {
        row.as_ref().map(to_milestone)
    })
}

/// `list(filter?)`: the project's milestones, soonest target first, undated last. No project,
/// no request.
fn list(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_milestone);
    }
    let filter: Filter = if call.arg(0).is_null() {
        Filter::default()
    } else {
        match call.parse(0) {
            Ok(f) => f,
            Err(e) => return RepoStep::fail(e),
        }
    };
    let Some(pid) = call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) else {
        return RepoStep::done(&Vec::<Milestone>::new());
    };
    let mut q = RepoQuery::select(TABLE, MILESTONE_COLUMNS).eq("project_id", pid);
    if let Some(status) = filter.status.filter(|s| !s.is_empty()) {
        q = q.eq("status", status);
    }
    RepoStep::send(q.order_nulls("target_date", true, false))
}

/// `save(milestone)`: upsert, stamped with the open project when there is one.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let milestone: Milestone = match call.parse(0) {
        Ok(m) => m,
        Err(e) => return RepoStep::fail(e),
    };
    let mut row = match serde_json::to_value(to_row(&milestone)) {
        Ok(row) => row,
        Err(e) => return RepoStep::fail(e),
    };
    if let (Some(pid), Value::Object(map)) = (
        call.ctx.project_id.as_deref().filter(|p| !p.is_empty()),
        &mut row,
    ) {
        let _ = map.insert("project_id".into(), Value::from(pid));
    }
    RepoStep::send(RepoQuery::upsert(TABLE, row))
}

/// `delete(id)`: removes by id alone, as `deleteRowById` does.
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
    use serde_json::json;

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

    fn no_project(args: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies: vec![],
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

    fn row(id: &str) -> Value {
        json!({ "id": id, "title": "Draft chapter 2", "description": null,
            "status": "in_progress", "target_date": null, "dependencies": null,
            "compute": null, "created_at": "2026-11-05T00:00:00.000Z" })
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn get_by_id_reads_every_column_by_id() {
        let q = sent(get_by_id(&call(vec![json!("m1")], vec![])));
        assert_eq!(q.table, TABLE);
        assert_eq!(q.columns.as_deref(), Some("*"));
        assert_eq!(q.single, RepoSingle::Maybe);
        assert_eq!(q.filters[0].column, "id");
    }

    #[test]
    fn get_by_id_maps_a_missing_row_to_null() {
        let v = done(get_by_id(&call(vec![json!("m1")], vec![Value::Null])));
        assert_eq!(v, Value::Null);
    }

    #[test]
    fn get_by_id_maps_a_row_to_the_domain_milestone() {
        let v = done(get_by_id(&call(vec![json!("m1")], vec![row("m1")])));
        assert_eq!(v["id"], "m1");
        assert_eq!(v["createdAt"], "2026-11-05T00:00:00.000Z");
    }

    #[test]
    fn list_without_a_project_is_empty_and_sends_nothing() {
        let v = done(list(&no_project(vec![])));
        assert_eq!(v, json!([]));
    }

    #[test]
    fn list_scopes_filters_status_and_orders_by_target() {
        let q = sent(list(&call(
            vec![json!({ "status": "done", "titleContains": "x" })],
            vec![],
        )));
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[0].value, json!("p1"));
        assert_eq!(q.filters[1].column, "status");
        assert_eq!(q.filters[1].value, json!("done"));
        assert_eq!(q.filters.len(), 2);
        assert_eq!(q.order[0].column, "target_date");
        assert!(q.order[0].ascending);
        assert_eq!(q.order[0].nulls_first, Some(false));
    }

    #[test]
    fn list_ignores_an_empty_status() {
        let q = sent(list(&call(vec![json!({ "status": "" })], vec![])));
        assert_eq!(q.filters.len(), 1);
    }

    #[test]
    fn list_maps_rows_to_milestones() {
        let v = done(list(&call(vec![], vec![json!([row("m1")])])));
        assert_eq!(v[0]["id"], "m1");
        assert_eq!(v[0]["status"], "in_progress");
        assert!(v[0].get("description").is_none());
    }

    #[test]
    fn save_stamps_the_project_and_writes_nulls() {
        let milestone = json!({ "id": "m1", "title": "Draft", "status": "in_progress",
            "dependencies": [], "compute": [], "createdAt": "2026-11-05T00:00:00.000Z" });
        let q = sent(save(&call(vec![milestone], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.expect("body");
        assert_eq!(body["project_id"], "p1");
        assert!(body["target_date"].is_null());
        assert_eq!(body["status"], "in_progress");
    }

    #[test]
    fn save_without_a_project_omits_project_id() {
        let milestone = json!({ "id": "m1", "title": "Draft", "status": "planned",
            "dependencies": [], "compute": [], "createdAt": "2026-11-05T00:00:00.000Z" });
        let q = sent(save(&no_project(vec![milestone])));
        assert!(q.body.expect("body").get("project_id").is_none());
    }

    #[test]
    fn delete_targets_the_id_only() {
        let q = sent(delete(&call(vec![json!("m1")], vec![])));
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters.len(), 1);
        assert_eq!(q.filters[0].column, "id");
    }
}

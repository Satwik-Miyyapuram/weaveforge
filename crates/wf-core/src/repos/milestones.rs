//! The `milestones` repository as Rust-planned queries (TS `SpecRepository` over the `milestones`
//! row spec in `backend/providers/postgrest/parts-1.ts`, wired in `wire-postgrest-backend.ts`).
//! Row mapping is `plan::milestone_row`. Writes stamp the selected project; reads by id do not.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::lab_snapshot::MilestoneStatus;
use crate::plan::milestone::{
    ComputeNeed, Milestone, MilestoneDependency, NewMilestoneInput, create_milestone, is_iso_day,
    validate_compute, validate_dependencies,
};
use crate::plan::milestone_row::{MilestoneRow, to_milestone, to_row};
use crate::postgrest_spec::MILESTONE_COLUMNS;
use crate::reader_analysis::lines::js_trim;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "milestones";

/// `MilestoneFilter` as the list reads it. Only `status` is applied; other keys are ignored.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Filter {
    #[serde(default)]
    status: Option<String>,
}

/// `EditMilestoneInput`: a partial edit. An absent field keeps the stored value.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct EditInput {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    status: Option<MilestoneStatus>,
    #[serde(default)]
    target_date: Option<String>,
    #[serde(default)]
    dependencies: Option<Vec<MilestoneDependency>>,
    #[serde(default)]
    compute: Option<Vec<ComputeNeed>>,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "list" => list(call),
        "save" => save(call),
        "delete" => delete(call),
        "add" => add(call),
        "setStatus" => set_status(call),
        "update" => update(call),
        "remove" => delete(call),
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

/// `add(input)`: builds the milestone with `call.id(0)` and the sender's clock, then saves it.
/// Validation fails before anything is sent. The result is the milestone once the save replies.
fn add(call: &RepoCall) -> RepoStep {
    let input: NewMilestoneInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let milestone = match create_milestone(&input, &call.id(0), call.now()) {
        Ok(milestone) => milestone,
        Err(e) => return RepoStep::fail_named("MilestoneValidationError", e),
    };
    let value = match serde_json::to_value(&milestone) {
        Ok(value) => value,
        Err(e) => return RepoStep::fail(e),
    };
    let saved = save(&call.sub(vec![value], 0));
    if call.replies.is_empty() || matches!(saved, RepoStep::Fail { .. }) {
        return saved;
    }
    RepoStep::done(&milestone)
}

/// `setStatus(id, status)`: changes only the status.
fn set_status(call: &RepoCall) -> RepoStep {
    let status: MilestoneStatus = match call.parse(1) {
        Ok(status) => status,
        Err(e) => return RepoStep::fail(e),
    };
    mutate(call, call.text(0), |m| Milestone {
        status,
        ..m.clone()
    })
}

/// `update(id, input)`: validates in TS order (title, target date, dependencies, compute), then
/// applies the present fields. An empty `targetDate` clears the date.
fn update(call: &RepoCall) -> RepoStep {
    let input: EditInput = match call.parse(1) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    if input
        .title
        .as_deref()
        .is_some_and(|t| js_trim(t).is_empty())
    {
        return RepoStep::fail_named("MilestoneValidationError", "Milestone title is required.");
    }
    if let Some(date) = input.target_date.as_deref().filter(|d| !d.is_empty())
        && !is_iso_day(date)
    {
        return RepoStep::fail_named(
            "MilestoneValidationError",
            "Target date must be yyyy-mm-dd.",
        );
    }
    if let Some(deps) = &input.dependencies
        && let Err(e) = validate_dependencies(deps)
    {
        return RepoStep::fail_named("MilestoneValidationError", e);
    }
    if let Some(compute) = &input.compute
        && let Err(e) = validate_compute(compute)
    {
        return RepoStep::fail_named("MilestoneValidationError", e);
    }
    mutate(call, call.text(0), |m| Milestone {
        title: input
            .title
            .as_deref()
            .map_or_else(|| m.title.clone(), |t| js_trim(t).to_owned()),
        description: input.description.clone().or_else(|| m.description.clone()),
        status: input.status.unwrap_or(m.status),
        target_date: match input.target_date.as_deref() {
            Some("") => None,
            Some(date) => Some(date.to_owned()),
            None => m.target_date.clone(),
        },
        dependencies: input
            .dependencies
            .clone()
            .unwrap_or_else(|| m.dependencies.clone()),
        compute: input.compute.clone().unwrap_or_else(|| m.compute.clone()),
        ..m.clone()
    })
}

/// Read milestone `id`, apply `change`, save it, and finish with the updated milestone. Runs
/// `getById` then `save` with `call.sub`; a missing milestone fails as NotFound.
fn mutate(call: &RepoCall, id: &str, change: impl Fn(&Milestone) -> Milestone) -> RepoStep {
    let got = get_by_id(&call.sub(vec![json!(id)], 0));
    let value = match got {
        RepoStep::Done { value } => value,
        other => return other,
    };
    let existing: Option<Milestone> = match serde_json::from_value(value) {
        Ok(existing) => existing,
        Err(e) => return RepoStep::fail(e),
    };
    let Some(existing) = existing else {
        return RepoStep::fail_named("NotFoundError", format!("No milestone with id \"{id}\"."));
    };
    let updated = change(&existing);
    let value = match serde_json::to_value(&updated) {
        Ok(value) => value,
        Err(e) => return RepoStep::fail(e),
    };
    let saved = save(&call.sub(vec![value], 1));
    if call.replies.len() < 2 || matches!(saved, RepoStep::Fail { .. }) {
        return saved;
    }
    RepoStep::done(&updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    const NOW: &str = "2026-06-30T12:00:00.000Z";

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                id_seed: Some("seed".into()),
                now: Some(NOW.into()),
                ..RepoCtx::default()
            },
        }
    }

    fn fail(step: RepoStep) -> (Option<String>, String) {
        match step {
            RepoStep::Fail { message, name } => (name, message),
            other => panic!("expected fail, got {other:?}"),
        }
    }

    fn dated_row(id: &str, target: Option<&str>) -> Value {
        let mut r = row(id);
        r["target_date"] = json!(target);
        r
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

    #[test]
    fn add_saves_the_new_milestone_with_the_project_and_seeded_id() {
        let c = call(vec![json!({ "title": "Draft" })], vec![]);
        let q = sent(add(&c));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.expect("body");
        assert_eq!(body["id"], c.id(0));
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["created_at"], NOW);
    }

    #[test]
    fn add_applies_defaults() {
        let c = call(
            vec![json!({ "title": "Literature review done" })],
            vec![Value::Null],
        );
        let v = done(add(&c));
        assert_eq!(v["status"], "planned");
        assert_eq!(v["dependencies"], json!([]));
        assert_eq!(v["compute"], json!([]));
        assert_eq!(v["id"], c.id(0));
    }

    #[test]
    fn add_rejects_empty_title_and_bad_date() {
        let (name, msg) = fail(add(&call(vec![json!({ "title": "  " })], vec![])));
        assert_eq!(name.as_deref(), Some("MilestoneValidationError"));
        assert_eq!(msg, "Milestone title is required.");
        let (_, msg) = fail(add(&call(
            vec![json!({ "title": "x", "targetDate": "30-06-2026" })],
            vec![],
        )));
        assert_eq!(msg, "Target date must be yyyy-mm-dd.");
    }

    #[test]
    fn add_validates_dependencies() {
        let (_, msg) = fail(add(&call(
            vec![json!({ "title": "x", "dependencies": [{ "kind": "external" }] })],
            vec![],
        )));
        assert_eq!(msg, "External dependencies need a label.");
        let bad_ref = add(&call(
            vec![json!({ "title": "x", "dependencies": [{ "kind": "experiment" }] })],
            vec![],
        ));
        assert!(matches!(bad_ref, RepoStep::Fail { .. }));
        let ok = done(add(&call(
            vec![json!({
                "title": "x",
                "dependencies": [
                    { "kind": "external", "label": "cluster account" },
                    { "kind": "paper", "refId": "p1" }
                ]
            })],
            vec![Value::Null],
        )));
        assert_eq!(ok["dependencies"].as_array().map(Vec::len), Some(2));
    }

    #[test]
    fn add_validates_compute() {
        for bad in [
            json!({ "resource": " " }),
            json!({ "resource": "A100", "count": 0 }),
            json!({ "resource": "A100", "hours": -1 }),
        ] {
            let c = call(vec![json!({ "title": "x", "compute": [bad] })], vec![]);
            assert!(matches!(add(&c), RepoStep::Fail { .. }));
        }
        let ok = done(add(&call(
            vec![json!({
                "title": "x",
                "compute": [{ "resource": "A100", "count": 4, "hours": 200 }]
            })],
            vec![Value::Null],
        )));
        assert_eq!(ok["compute"].as_array().map(Vec::len), Some(1));
        assert_eq!(ok["compute"][0]["count"], json!(4.0));
    }

    #[test]
    fn set_status_changes_only_the_status() {
        let first = sent(set_status(&call(vec![json!("m1"), json!("done")], vec![])));
        assert_eq!(first.action, RepoAction::Select);
        let c = call(
            vec![json!("m1"), json!("done")],
            vec![dated_row("m1", Some("2026-08-01"))],
        );
        let q = sent(set_status(&c));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.expect("body");
        assert_eq!(body["status"], "done");
        assert_eq!(body["target_date"], "2026-08-01");
        assert_eq!(body["title"], "Draft chapter 2");
        let v = done(set_status(&call(
            vec![json!("m1"), json!("done")],
            vec![dated_row("m1", Some("2026-08-01")), Value::Null],
        )));
        assert_eq!(v["status"], "done");
        assert_eq!(v["targetDate"], "2026-08-01");
    }

    #[test]
    fn update_edits_fields_and_clears_the_date_with_an_empty_string() {
        let input = json!({
            "title": "y",
            "targetDate": "",
            "compute": [{ "resource": "A100", "count": 2 }]
        });
        let c = call(
            vec![json!("m1"), input],
            vec![dated_row("m1", Some("2026-08-01"))],
        );
        let q = sent(update(&c));
        let body = q.body.expect("body");
        assert_eq!(body["title"], "y");
        assert!(body["target_date"].is_null());
        assert_eq!(body["compute"].as_array().map(Vec::len), Some(1));
        let v = done(update(&call(
            vec![
                json!("m1"),
                json!({ "title": "y", "targetDate": "", "compute": [{ "resource": "A100", "count": 2 }] }),
            ],
            vec![dated_row("m1", Some("2026-08-01")), Value::Null],
        )));
        assert_eq!(v["title"], "y");
        assert!(v.get("targetDate").is_none());
        assert_eq!(v["compute"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn update_rejects_an_unknown_id() {
        let c = call(
            vec![json!("nope"), json!({ "title": "y" })],
            vec![Value::Null],
        );
        let (name, msg) = fail(update(&c));
        assert_eq!(name.as_deref(), Some("NotFoundError"));
        assert_eq!(msg, "No milestone with id \"nope\".");
    }

    #[test]
    fn update_validates_before_reading_the_milestone() {
        let c = call(vec![json!("m1"), json!({ "title": "  " })], vec![]);
        let (name, msg) = fail(update(&c));
        assert_eq!(name.as_deref(), Some("MilestoneValidationError"));
        assert_eq!(msg, "Milestone title is required.");
    }

    #[test]
    fn update_rejects_a_bad_target_date() {
        let c = call(vec![json!("m1"), json!({ "targetDate": "30-06-2026" })], vec![]);
        let (name, msg) = fail(update(&c));
        assert_eq!(name.as_deref(), Some("MilestoneValidationError"));
        assert_eq!(msg, "Target date must be yyyy-mm-dd.");
    }

    #[test]
    fn update_keeps_the_id_and_created_at() {
        let c = call(
            vec![json!("m1"), json!({ "title": "y" })],
            vec![dated_row("m1", None), Value::Null],
        );
        let v = done(update(&c));
        assert_eq!(v["id"], "m1");
        assert_eq!(v["createdAt"], "2026-11-05T00:00:00.000Z");
    }

    #[test]
    fn remove_deletes_the_milestone() {
        let first = sent(step("remove", &call(vec![json!("m1")], vec![])).expect("known"));
        assert_eq!(first.action, RepoAction::Delete);
        let v = done(step("remove", &call(vec![json!("m1")], vec![Value::Null])).expect("known"));
        assert_eq!(v, Value::Null);
    }

    #[test]
    fn list_orders_by_target_date_undated_last() {
        let q = sent(list(&call(vec![], vec![])));
        assert_eq!(q.order[0].column, "target_date");
        assert!(q.order[0].ascending);
        assert_eq!(q.order[0].nulls_first, Some(false));
    }
}

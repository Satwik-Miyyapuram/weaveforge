//! The `experiments` repository as Rust-planned queries.
//!
//! Ported from `PostgrestExperimentRepository` in
//! `apps/web/src/features/experiments/infrastructure/parts.ts`. Rows map with
//! [`to_domain`] and [`to_row`] from `experiment_rows`. `ExperimentArtifactStore` (blob
//! upload and signing) stays in TS. `nameContains` has no server filter: names are
//! encrypted at rest, so the match runs here after the read.

use std::collections::HashSet;

use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::experiment_rows::{ExperimentRow, to_domain, to_row};
use crate::experiment_status::{self, ExperimentStatus, status_patch_for_experiment};
use crate::experiments::{Experiment, NewExperimentInput, create_experiment};
use crate::reader_analysis::lines::js_trim;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row};

const TABLE: &str = "experiments";

/// Experiment ids per `in` read; the list travels in the URL.
const ID_CHUNK: usize = 200;

/// The columns an [`ExperimentRow`] is read as, named rather than starred.
pub const EXPERIMENT_COLUMNS: &str = "id,name,hypothesis,status,repo_url,commit_sha,branch,run_command,config,metrics,artifacts,result_note,started_at,finished_at,related_paper,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "listByIds" => list_by_ids(call),
        "list" => list(call),
        "save" => save(call),
        "patch" => patch(call),
        "delete" => delete(call),
        "add" => add(call),
        "setStatus" => set_status(call),
        "recordMetrics" => record_metrics(call),
        "addArtifacts" => add_artifacts(call),
        "setResultNote" => set_result_note(call),
        "remove" => delete(call),
        _ => return None,
    })
}

/// `ExperimentFilter`, minus the server-side handling of `nameContains`.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Filter {
    status: Option<String>,
    related_paper: Option<String>,
    name_contains: Option<String>,
}

/// The filter argument; a missing one filters nothing.
fn filter_arg(call: &RepoCall) -> Result<Filter, String> {
    if call.arg(0).is_null() {
        return Ok(Filter::default());
    }
    call.parse(0)
}

/// The selected project, when one is set (TS `this.pid` truthy).
fn project_id(call: &RepoCall) -> Option<&str> {
    call.ctx.project_id.as_deref().filter(|id| !id.is_empty())
}

/// Whether `name` contains the lowercased `needle`, or there is no needle.
fn name_matches(name: &str, needle: Option<&str>) -> bool {
    needle.is_none_or(|n| name.to_lowercase().contains(n))
}

/// `camelCase` to `snake_case` for patch keys (TS `/[A-Z]/` to `_` + lowercase).
fn snake_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for c in key.chars() {
        if c.is_ascii_uppercase() {
            out.push('_');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// `getById(id)`: the experiment, or `null`. Not project-scoped.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, "*")
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<ExperimentRow>| {
        row.as_ref().map(to_domain)
    })
}

/// `listByIds(ids)`: by id, not by project; chunks are requested together and
/// concatenated in chunk order.
fn list_by_ids(call: &RepoCall) -> RepoStep {
    let ids: Vec<String> = match call.parse(0) {
        Ok(ids) => ids,
        Err(e) => return RepoStep::fail(e),
    };
    let chunks: Vec<Vec<String>> = ids.chunks(ID_CHUNK).map(<[String]>::to_vec).collect();
    if chunks.is_empty() {
        return RepoStep::done(&Vec::<Experiment>::new());
    }
    if call.replies.is_empty() {
        let queries = chunks
            .into_iter()
            .map(|chunk| {
                RepoQuery::select(TABLE, EXPERIMENT_COLUMNS)
                    .filter("in", "id", chunk)
                    .order("id", true)
            })
            .collect();
        return RepoStep::Send { queries };
    }
    let mut found = Vec::new();
    for i in 0..chunks.len() {
        match call.reply::<Vec<ExperimentRow>>(i) {
            Some(Ok(rows)) => found.extend(rows.iter().map(to_domain)),
            Some(Err(e)) => return RepoStep::fail(e),
            None => return RepoStep::fail(format!("reply {i} missing")),
        }
    }
    RepoStep::done(&found)
}

/// `list(filter?)`: newest created first, scoped to the project or unassigned.
fn list(call: &RepoCall) -> RepoStep {
    let filter = match filter_arg(call) {
        Ok(filter) => filter,
        Err(e) => return RepoStep::fail(e),
    };
    if call.replies.is_empty() {
        let mut q = RepoQuery::select(TABLE, EXPERIMENT_COLUMNS);
        if let Some(pid) = project_id(call) {
            q = q.filter("or", "", format!("project_id.eq.{pid},project_id.is.null"));
        }
        if let Some(status) = filter.status.filter(|s| !s.is_empty()) {
            q = q.eq("status", status);
        }
        if let Some(paper) = filter.related_paper.filter(|s| !s.is_empty()) {
            q = q.eq("related_paper", paper);
        }
        return RepoStep::send(q.order("created_at", false));
    }
    let needle = filter
        .name_contains
        .filter(|n| !n.is_empty())
        .map(|n| n.to_lowercase());
    match call.reply::<Vec<ExperimentRow>>(0) {
        Some(Ok(rows)) => {
            let found: Vec<Experiment> = rows
                .iter()
                .map(to_domain)
                .filter(|e| name_matches(&e.name, needle.as_deref()))
                .collect();
            RepoStep::done(&found)
        }
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `save(experiment)`: upsert, stamped with the open project when there is one.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let experiment: Experiment = match call.parse(0) {
        Ok(experiment) => experiment,
        Err(e) => return RepoStep::fail(e),
    };
    let mut row = json!(to_row(&experiment));
    if let (Some(pid), Value::Object(map)) = (project_id(call), &mut row) {
        let _ = map.insert("project_id".into(), json!(pid));
    }
    RepoStep::send(RepoQuery::upsert(TABLE, row))
}

/// `patch(id, fields)`: updates only the named columns. The whole-experiment mapper
/// builds their values, with a filler for the fields the patch leaves out.
fn patch(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let fields = match call.arg(1) {
        Value::Object(fields) if !fields.is_empty() => fields,
        _ => return RepoStep::unit(),
    };
    let mut whole = json!({
        "id": "",
        "name": "",
        "status": "planned",
        "config": {},
        "metrics": {},
        "artifacts": [],
        "createdAt": "",
    });
    if let Value::Object(map) = &mut whole {
        for (key, value) in fields {
            let _ = map.insert(key.clone(), value.clone());
        }
    }
    let experiment: Experiment = match serde_json::from_value(whole) {
        Ok(experiment) => experiment,
        Err(e) => return RepoStep::fail(e),
    };
    let full: Map<String, Value> = match json!(to_row(&experiment)) {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    let mut row = Map::new();
    for key in fields.keys() {
        let column = snake_case(key);
        if let Some(value) = full.get(&column) {
            let _ = row.insert(column, value.clone());
        }
    }
    RepoStep::send(RepoQuery::update(TABLE, Value::Object(row)).eq("id", call.text(0)))
}

/// `delete(id)`. Not project-scoped.
fn delete(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// `add(input)`: a new run with a fresh id, saved as one upsert; replies the saved run (TS `add`).
fn add(call: &RepoCall) -> RepoStep {
    let input: NewExperimentInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let experiment = match create_experiment(&input, &call.id(0), call.now()) {
        Ok(experiment) => experiment,
        Err(message) => return RepoStep::fail_named("ExperimentValidationError", message),
    };
    match sub_done(save(&call.sub(vec![json!(experiment)], 0))) {
        Ok(_) => RepoStep::done(&experiment),
        Err(step) => step,
    }
}

/// `setStatus(id, status)`: the timestamp rules of `status_patch_for_experiment`, written as the
/// status and both timestamps. Clearing `finishedAt` on reopen is an explicit `null`.
fn set_status(call: &RepoCall) -> RepoStep {
    let status: ExperimentStatus = match call.parse(1) {
        Ok(status) => status,
        Err(e) => return RepoStep::fail(e),
    };
    mutate(call, |existing| {
        let timing = experiment_status::Experiment {
            status: existing.status,
            started_at: existing.started_at.clone(),
            created_at: existing.created_at.clone(),
        };
        let patch = status_patch_for_experiment(&timing, status, call.now());
        object(json!({
            "status": patch.status,
            "startedAt": patch.started_at,
            "finishedAt": patch.finished_at,
        }))
    })
}

/// `recordMetrics(id, metrics)`: a shallow merge into the stored metrics.
fn record_metrics(call: &RepoCall) -> RepoStep {
    let metrics: Map<String, Value> = match call.parse(1) {
        Ok(metrics) => metrics,
        Err(e) => return RepoStep::fail(e),
    };
    mutate(call, move |existing| {
        let mut merged = existing.metrics.clone();
        merged.extend(metrics);
        object(json!({ "metrics": merged }))
    })
}

/// `addArtifacts(id, entries)`: appends the entries not stored yet, in first-seen order.
fn add_artifacts(call: &RepoCall) -> RepoStep {
    let entries: Vec<String> = match call.parse(1) {
        Ok(entries) => entries,
        Err(e) => return RepoStep::fail(e),
    };
    mutate(call, move |existing| {
        let mut seen: HashSet<String> = HashSet::new();
        let artifacts: Vec<String> = existing
            .artifacts
            .iter()
            .chain(&entries)
            .filter(|artifact| seen.insert((*artifact).clone()))
            .cloned()
            .collect();
        object(json!({ "artifacts": artifacts }))
    })
}

/// `setResultNote(id, note)`: the trimmed note, or `null` when blank so the run has no result.
fn set_result_note(call: &RepoCall) -> RepoStep {
    let note = js_trim(call.text(1)).to_owned();
    mutate(call, move |_| {
        let result_note = if note.is_empty() {
            Value::Null
        } else {
            json!(note)
        };
        object(json!({ "resultNote": result_note }))
    })
}

/// TS `mutate`: reads the run named by arg 0, writes only the fields `change` returns, and replies
/// with the stored run merged with them. Reply 0 is the read, reply 1 the write.
fn mutate(call: &RepoCall, change: impl FnOnce(&Experiment) -> Map<String, Value>) -> RepoStep {
    let id = call.text(0);
    let existing: Experiment = match sub_done(get_by_id(&call.sub(vec![json!(id)], 0))) {
        Ok(Value::Null) => {
            return RepoStep::fail_named(
                "NotFoundError",
                format!("No experiment with id \"{id}\"."),
            );
        }
        Ok(value) => match serde_json::from_value(value) {
            Ok(experiment) => experiment,
            Err(e) => return RepoStep::fail(e),
        },
        Err(step) => return step,
    };
    let fields = change(&existing);
    let mut merged = json!(existing);
    if let Value::Object(map) = &mut merged {
        map.extend(fields.clone());
    }
    let merged: Experiment = match serde_json::from_value(merged) {
        Ok(merged) => merged,
        Err(e) => return RepoStep::fail(e),
    };
    match sub_done(patch(&call.sub(vec![json!(id), Value::Object(fields)], 1))) {
        Ok(_) => RepoStep::done(&merged),
        Err(step) => step,
    }
}

/// The map of a JSON object literal; anything else is an empty map.
fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

/// The value of a sub-step that finished, or the step it still needs (a send or a failure).
fn sub_done(step: RepoStep) -> Result<Value, RepoStep> {
    match step {
        RepoStep::Done { value } => Ok(value),
        other => Err(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    /// The instant the write arms stamp.
    const NOW: &str = "2026-03-02T10:00:00Z";

    fn call(args: Vec<Value>, replies: Vec<Value>, project: Option<&str>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: project.map(String::from),
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

    fn sent_all(step: RepoStep) -> Vec<RepoQuery> {
        match step {
            RepoStep::Send { queries } => queries,
            other => panic!("expected send, got {other:?}"),
        }
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    fn row(id: &str, name: &str) -> Value {
        json!({
            "id": id, "name": name, "hypothesis": null, "status": "running",
            "repo_url": null, "commit_sha": null, "branch": null, "run_command": null,
            "config": null, "metrics": null, "artifacts": null, "result_note": null,
            "started_at": null, "finished_at": null, "related_paper": null,
            "created_at": "2026-03-01T00:00:00Z"
        })
    }

    fn experiment() -> Value {
        json!({
            "id": "e1", "name": "Baseline", "status": "planned",
            "config": {}, "metrics": {}, "artifacts": [],
            "createdAt": "2026-03-01T00:00:00Z"
        })
    }

    #[test]
    fn get_by_id_reads_maybe_single_row() {
        let q = sent(get_by_id(&call(vec![json!("e1")], vec![], None)));
        assert_eq!(q.table, TABLE);
        assert_eq!(q.columns.as_deref(), Some("*"));
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(q.single, RepoSingle::Maybe);
    }

    #[test]
    fn get_by_id_maps_row_or_null() {
        assert_eq!(
            done(get_by_id(&call(vec![json!("e1")], vec![Value::Null], None))),
            Value::Null
        );
        let v = done(get_by_id(&call(
            vec![json!("e1")],
            vec![row("e1", "Baseline")],
            None,
        )));
        assert_eq!(v["id"], "e1");
        assert_eq!(v["config"], json!({}));
        assert!(v.get("hypothesis").is_none());
    }

    #[test]
    fn list_by_ids_chunks_by_200_and_sends_together() {
        let ids: Vec<Value> = (1..=201).map(|i| json!(format!("e{i}"))).collect();
        let queries = sent_all(list_by_ids(&call(vec![json!(ids)], vec![], Some("p1"))));
        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0].filters[0].op, "in");
        assert_eq!(
            queries[0].filters[0].value.as_array().map(Vec::len),
            Some(200)
        );
        assert_eq!(
            queries[1].filters[0].value.as_array().map(Vec::len),
            Some(1)
        );
        assert_eq!(queries[0].order[0].column, "id");
        assert!(queries[0].filters.iter().all(|f| f.column != "project_id"));
    }

    #[test]
    fn list_by_ids_empty_reads_nothing() {
        assert_eq!(
            done(list_by_ids(&call(vec![json!([])], vec![], None))),
            json!([])
        );
    }

    #[test]
    fn list_by_ids_concatenates_chunk_replies_in_order() {
        let ids: Vec<Value> = (1..=201).map(|i| json!(format!("e{i}"))).collect();
        let v = done(list_by_ids(&call(
            vec![json!(ids)],
            vec![json!([row("e1", "A")]), json!([row("e201", "B")])],
            None,
        )));
        assert_eq!(v[0]["id"], "e1");
        assert_eq!(v[1]["id"], "e201");
    }

    #[test]
    fn list_scopes_to_project_or_unassigned_newest_first() {
        let q = sent(list(&call(vec![Value::Null], vec![], Some("p1"))));
        assert_eq!(q.filters[0].op, "or");
        assert_eq!(
            q.filters[0].value,
            json!("project_id.eq.p1,project_id.is.null")
        );
        assert_eq!(q.order[0].column, "created_at");
        assert!(!q.order[0].ascending);
    }

    #[test]
    fn list_without_project_applies_status_only() {
        let q = sent(list(&call(
            vec![json!({"status": "running"})],
            vec![],
            None,
        )));
        assert!(q.filters.iter().all(|f| f.op != "or"));
        assert_eq!(q.filters[0].op, "eq");
        assert_eq!(q.filters[0].column, "status");
        assert_eq!(q.filters[0].value, json!("running"));
    }

    #[test]
    fn list_filters_names_after_the_read() {
        let v = done(list(&call(
            vec![json!({"nameContains": "BASE"})],
            vec![json!([row("e1", "Baseline"), row("e2", "Ablation")])],
            Some("p1"),
        )));
        assert_eq!(v.as_array().map(Vec::len), Some(1));
        assert_eq!(v[0]["id"], "e1");
    }

    #[test]
    fn save_upserts_row_stamped_with_project() {
        let q = sent(save(&call(vec![experiment()], vec![], Some("p1"))));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.expect("body");
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["id"], "e1");
        assert_eq!(body["hypothesis"], Value::Null);
    }

    #[test]
    fn save_without_project_sends_no_project_id() {
        let q = sent(save(&call(vec![experiment()], vec![], None)));
        assert!(
            q.body
                .as_ref()
                .is_some_and(|b| b.get("project_id").is_none())
        );
    }

    #[test]
    fn save_replies_unit() {
        assert_eq!(
            save(&call(vec![experiment()], vec![Value::Null], None)),
            RepoStep::unit()
        );
    }

    #[test]
    fn patch_with_no_fields_sends_nothing() {
        assert_eq!(
            patch(&call(vec![json!("e1"), json!({})], vec![], None)),
            RepoStep::unit()
        );
    }

    #[test]
    fn patch_updates_only_named_columns_in_snake_case() {
        let q = sent(patch(&call(
            vec![json!("e1"), json!({"resultNote": "ok", "repoUrl": null})],
            vec![],
            None,
        )));
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(
            q.body.expect("body"),
            json!({"result_note": "ok", "repo_url": null})
        );
        assert_eq!(q.filters[0].column, "id");
        assert_eq!(q.filters[0].value, json!("e1"));
    }

    #[test]
    fn snake_case_maps_camel_keys() {
        assert_eq!(snake_case("relatedPaper"), "related_paper");
        assert_eq!(snake_case("name"), "name");
    }

    #[test]
    fn delete_removes_by_id_and_is_not_project_scoped() {
        let q = sent(delete(&call(vec![json!("e1")], vec![], Some("p1"))));
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "id");
        assert!(q.filters.iter().all(|f| f.column != "project_id"));
        assert_eq!(
            delete(&call(vec![json!("e1")], vec![Value::Null], None)),
            RepoStep::unit()
        );
    }

    /// A call with the write clock and a fixed id seed, so replays mint the same id.
    fn timed(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                now: Some(NOW.to_owned()),
                id_seed: Some("seed".to_owned()),
                ..RepoCtx::default()
            },
        }
    }

    /// A stored run `e1`: the `row` fixture with `fields` overriding its columns.
    fn stored(fields: Value) -> Value {
        let mut base = row("e1", "Baseline");
        if let (Value::Object(map), Value::Object(fields)) = (&mut base, fields) {
            map.extend(fields);
        }
        base
    }

    /// The sorted columns an update writes.
    fn written_columns(q: &RepoQuery) -> Vec<String> {
        let mut keys: Vec<String> = q
            .body
            .as_ref()
            .and_then(Value::as_object)
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default();
        keys.sort();
        keys
    }

    #[test]
    fn add_saves_defaults_and_replies_the_run() {
        let input = json!({"name": "Baseline"});
        let body = sent(add(&timed(vec![input.clone()], vec![])))
            .body
            .expect("body");
        assert_eq!(body["status"], "planned");
        assert_eq!(body["config"], json!({}));
        assert_eq!(body["artifacts"], json!([]));
        let v = done(add(&timed(vec![input], vec![Value::Null])));
        assert_eq!(v["status"], "planned");
        assert_eq!(v["config"], json!({}));
        assert_eq!(v["artifacts"], json!([]));
        assert_eq!(v["id"], body["id"]);
    }

    #[test]
    fn add_stamps_start_for_running_and_end_for_done() {
        let running = sent(add(&timed(
            vec![json!({"name": "R", "status": "running"})],
            vec![],
        )))
        .body
        .expect("body");
        assert_eq!(running["started_at"], NOW);
        assert_eq!(running["finished_at"], Value::Null);
        let finished = sent(add(&timed(
            vec![json!({"name": "D", "status": "done"})],
            vec![],
        )))
        .body
        .expect("body");
        assert_eq!(finished["finished_at"], NOW);
    }

    #[test]
    fn add_rejects_blank_name_as_validation_error() {
        match add(&timed(vec![json!({"name": "  "})], vec![])) {
            RepoStep::Fail { message, name } => {
                assert_eq!(message, "Experiment name is required.");
                assert_eq!(name.as_deref(), Some("ExperimentValidationError"));
            }
            other => panic!("expected fail, got {other:?}"),
        }
    }

    #[test]
    fn set_status_reads_then_writes_status_and_start() {
        let read = sent(set_status(&timed(
            vec![json!("e1"), json!("running")],
            vec![],
        )));
        assert_eq!(read.action, RepoAction::Select);
        assert_eq!(read.single, RepoSingle::Maybe);
        let q = sent(set_status(&timed(
            vec![json!("e1"), json!("running")],
            vec![stored(json!({}))],
        )));
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(written_columns(&q), ["finished_at", "started_at", "status"]);
        let body = q.body.expect("body");
        assert_eq!(body["status"], "running");
        assert_eq!(body["started_at"], NOW);
    }

    #[test]
    fn set_status_done_stamps_end_and_keeps_start() {
        let start = "2026-03-01T09:00:00Z";
        let run = stored(json!({"status": "running", "started_at": start}));
        let body = sent(set_status(&timed(
            vec![json!("e1"), json!("done")],
            vec![run.clone()],
        )))
        .body
        .expect("body");
        assert_eq!(body["started_at"], start);
        assert_eq!(body["finished_at"], NOW);
        let v = done(set_status(&timed(
            vec![json!("e1"), json!("done")],
            vec![run, Value::Null],
        )));
        assert_eq!(v["startedAt"], start);
        assert_eq!(v["finishedAt"], NOW);
        assert_eq!(v["status"], "done");
    }

    #[test]
    fn set_status_reopen_clears_finished_at_explicitly() {
        let run = stored(json!({
            "status": "done",
            "started_at": "2026-03-01T09:00:00Z",
            "finished_at": "2026-03-01T10:00:00Z"
        }));
        let q = sent(set_status(&timed(
            vec![json!("e1"), json!("running")],
            vec![run],
        )));
        let body = q.body.expect("body");
        assert!(body.get("finished_at").is_some_and(Value::is_null));
        assert_eq!(body["started_at"], "2026-03-01T09:00:00Z");
    }

    #[test]
    fn set_status_unknown_id_fails_and_writes_nothing() {
        match set_status(&timed(vec![json!("e9"), json!("done")], vec![Value::Null])) {
            RepoStep::Fail { message, name } => {
                assert_eq!(message, "No experiment with id \"e9\".");
                assert_eq!(name.as_deref(), Some("NotFoundError"));
            }
            other => panic!("expected fail, got {other:?}"),
        }
    }

    #[test]
    fn record_metrics_shallow_merges_and_writes_only_metrics() {
        let run = stored(json!({"metrics": {"acc": 0.1}}));
        let q = sent(record_metrics(&timed(
            vec![json!("e1"), json!({"acc": 0.9, "loss": 2})],
            vec![run.clone()],
        )));
        assert_eq!(written_columns(&q), ["metrics"]);
        assert_eq!(
            q.body.expect("body")["metrics"],
            json!({"acc": 0.9, "loss": 2})
        );
        let v = done(record_metrics(&timed(
            vec![json!("e1"), json!({"loss": 2})],
            vec![run, Value::Null],
        )));
        assert_eq!(v["metrics"], json!({"acc": 0.1, "loss": 2}));
    }

    #[test]
    fn add_artifacts_appends_and_skips_existing() {
        let run = stored(json!({"artifacts": ["u/e/loss.png"]}));
        let q = sent(add_artifacts(&timed(
            vec![json!("e1"), json!(["u/e/loss.png", "u/e/acc.png"])],
            vec![run],
        )));
        assert_eq!(written_columns(&q), ["artifacts"]);
        assert_eq!(
            q.body.expect("body")["artifacts"],
            json!(["u/e/loss.png", "u/e/acc.png"])
        );
    }

    #[test]
    fn add_artifacts_dedupes_repeats_within_one_call() {
        let run = stored(json!({"artifacts": ["u/e/loss.png"]}));
        let v = done(add_artifacts(&timed(
            vec![
                json!("e1"),
                json!([
                    "u/e/acc.png",
                    "u/e/acc.png",
                    "u/e/loss.png",
                    "u/e/f1.png",
                    "u/e/acc.png"
                ]),
            ],
            vec![run, Value::Null],
        )));
        assert_eq!(
            v["artifacts"],
            json!(["u/e/loss.png", "u/e/acc.png", "u/e/f1.png"])
        );
    }

    #[test]
    fn add_artifacts_with_nothing_new_keeps_the_list() {
        let run = stored(json!({"artifacts": ["u/e/loss.png"]}));
        let q = sent(add_artifacts(&timed(
            vec![json!("e1"), json!(["u/e/loss.png"])],
            vec![run],
        )));
        assert_eq!(q.body.expect("body")["artifacts"], json!(["u/e/loss.png"]));
    }

    #[test]
    fn set_result_note_trims_and_writes_only_the_note() {
        let run = stored(json!({}));
        let q = sent(set_result_note(&timed(
            vec![json!("e1"), json!("  ok  ")],
            vec![run],
        )));
        assert_eq!(written_columns(&q), ["result_note"]);
        assert_eq!(q.body.expect("body")["result_note"], "ok");
    }

    #[test]
    fn blank_result_note_is_sent_as_a_clear() {
        let run = stored(json!({"result_note": "old"}));
        let q = sent(set_result_note(&timed(
            vec![json!("e1"), json!("   ")],
            vec![run.clone()],
        )));
        let body = q.body.expect("body");
        assert!(body.get("result_note").is_some_and(Value::is_null));
        let v = done(set_result_note(&timed(
            vec![json!("e1"), json!("   ")],
            vec![run, Value::Null],
        )));
        assert_eq!(v["resultNote"], Value::Null);
    }

    #[test]
    fn remove_dispatches_to_a_delete_by_id() {
        let q = sent(step("remove", &call(vec![json!("e1")], vec![], None)).expect("method"));
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "id");
    }
}

//! The `experiments` repository as Rust-planned queries.
//!
//! Ported from `PostgrestExperimentRepository` in
//! `apps/web/src/features/experiments/infrastructure/parts.ts`. Rows map with
//! [`to_domain`] and [`to_row`] from `experiment_rows`. `ExperimentArtifactStore` (blob
//! upload and signing) stays in TS. `nameContains` has no server filter: names are
//! encrypted at rest, so the match runs here after the read.

use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::experiment_rows::{ExperimentRow, to_domain, to_row};
use crate::experiments::Experiment;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

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
}

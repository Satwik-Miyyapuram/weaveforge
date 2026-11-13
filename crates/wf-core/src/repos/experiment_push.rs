//! The server half of the desktop experiment push as Rust-planned queries.
//!
//! Ported from `LocalExperimentPusher` in `apps/web/src/backend/providers/local/parts-1.ts`.
//! The local PGlite reads, the cursor bookkeeping and the artifact uploads stay in TS (local
//! I/O and blob glue); every query the push sends to the server is planned here.

use serde_json::{Value, json};

use crate::experiments::plan_series_ingest;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row};

const METRICS: &str = "experiment_metrics";
const EXPERIMENTS: &str = "experiments";

/// The tables a metric reset clears on the server.
const RESET_TABLES: [&str; 2] = ["experiment_metric_points", "experiment_metric_chunks"];

/// Where a not-yet-pushed artifact lives (`ARTIFACT_PREFIX` in TS).
const ARTIFACT_PREFIX: &str = "app://artifacts/";

/// The lowest step: "nothing pushed yet" (the int4 minimum the TS cursor used).
const NO_STEP: f64 = -2_147_483_648.0;

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "clearReset" => clear_reset(call),
        "pushBatch" => push_batch(call),
        "setArtifacts" => set_artifacts(call),
        "staleArtifactIds" => stale_artifact_ids(call),
        _ => return None,
    })
}

/// `clearReset(experimentId)`: drops the experiment's server points and chunks.
fn clear_reset(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let id = call.text(0);
    RepoStep::Send {
        queries: RESET_TABLES
            .iter()
            .map(|t| RepoQuery::delete(t).eq("experiment_id", id))
            .collect(),
    }
}

/// `pushBatch(experimentId, metric, pushed, rows)`: sends one batch of local points
/// (`{step, value, wall_time}`, step order) thinned to the stored grid, and returns the new
/// cursor (the batch's last step).
///
/// It first clears the batch's range: if an earlier send landed but its cursor write did not,
/// the re-send then leaves no stray point. The superseded tip is removed last, softly, as before.
fn push_batch(call: &RepoCall) -> RepoStep {
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    let rows: Vec<Value> = match call.parse(3) {
        Ok(rows) => rows,
        Err(e) => return RepoStep::fail(e),
    };
    let Some(last) = rows.last().and_then(|r| r["step"].as_f64()) else {
        return RepoStep::fail("pushBatch needs at least one point");
    };
    let id = call.text(0);
    let metric = call.text(1);
    let pushed = call.arg(2).as_f64();
    let steps: Vec<f64> = rows.iter().filter_map(|r| r["step"].as_f64()).collect();
    let plan = plan_series_ingest(&steps, pushed);
    let series = |q: RepoQuery| q.eq("experiment_id", id).eq("metric", metric);
    match call.replies.len() {
        0 => RepoStep::send(
            series(RepoQuery::delete(METRICS))
                .filter("gt", "step", pushed.unwrap_or(NO_STEP))
                .filter("lte", "step", last),
        ),
        1 => {
            let keep: Vec<Value> = plan
                .keep
                .iter()
                .map(|&i| {
                    let mut row = rows[i].clone();
                    row["experiment_id"] = json!(id);
                    row["metric"] = json!(metric);
                    row["user_id"] = json!(user);
                    row
                })
                .collect();
            RepoStep::send(RepoQuery::insert(METRICS, Value::Array(keep)))
        }
        2 => match plan.superseded_tip_step {
            Some(tip) => RepoStep::send(series(RepoQuery::delete(METRICS)).eq("step", tip).soft()),
            None => RepoStep::done(&last),
        },
        _ => RepoStep::done(&last),
    }
}

/// `setArtifacts(id, artifacts)`: writes the experiment's artifact list on the server.
fn set_artifacts(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    RepoStep::send(
        RepoQuery::update(EXPERIMENTS, json!({ "artifacts": call.arg(1) })).eq("id", call.text(0)),
    )
}

/// `staleArtifactIds(ids)`: those of `ids` whose server row still names a local artifact.
fn stale_artifact_ids(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::select(EXPERIMENTS, "id,artifacts").filter(
            "in",
            "id",
            call.arg(0).clone(),
        ));
    }
    map_row(call, 0, |rows: &Option<Vec<Value>>| {
        rows.iter()
            .flatten()
            .filter(|r| r["artifacts"].to_string().contains(ARTIFACT_PREFIX))
            .filter_map(|r| r["id"].as_str().map(str::to_owned))
            .collect::<Vec<_>>()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                user_id: Some("u1".into()),
                ..RepoCtx::default()
            },
        }
    }

    fn queries(step: RepoStep) -> Vec<RepoQuery> {
        match step {
            RepoStep::Send { queries } => queries,
            other => panic!("expected send, got {other:?}"),
        }
    }

    fn sent(step: RepoStep) -> RepoQuery {
        queries(step).remove(0)
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    #[test]
    fn clear_reset_deletes_points_and_chunks() {
        let qs = queries(clear_reset(&call(vec![json!("e1")], vec![])));
        assert_eq!(qs.len(), 2);
        assert_eq!(qs[0].table, "experiment_metric_points");
        assert_eq!(qs[1].table, "experiment_metric_chunks");
        for q in &qs {
            assert_eq!(q.action, RepoAction::Delete);
            assert_eq!(q.filters[0].column, "experiment_id");
            assert_eq!(q.filters[0].value, "e1");
        }
        assert_eq!(
            done(clear_reset(&call(
                vec![json!("e1")],
                vec![Value::Null, Value::Null]
            ))),
            Value::Null
        );
    }

    fn batch_args(pushed: Value) -> Vec<Value> {
        // Past 10 000 steps only every 2nd is kept: 10 001 is dropped, 10 003 kept as newest.
        let rows = json!([
            { "step": 10_000, "value": 1.0, "wall_time": 10 },
            { "step": 10_001, "value": 2.0, "wall_time": 11 },
            { "step": 10_003, "value": 3.0, "wall_time": 12 },
        ]);
        vec![json!("e1"), json!("loss"), pushed, rows]
    }

    #[test]
    fn push_batch_clears_the_range_first() {
        let q = sent(push_batch(&call(batch_args(Value::Null), vec![])));
        assert_eq!(q.table, METRICS);
        assert_eq!(q.action, RepoAction::Delete);
        let ops: Vec<(&str, &str)> = q
            .filters
            .iter()
            .map(|f| (f.op.as_str(), f.column.as_str()))
            .collect();
        assert_eq!(
            ops,
            [
                ("eq", "experiment_id"),
                ("eq", "metric"),
                ("gt", "step"),
                ("lte", "step")
            ]
        );
        assert_eq!(q.filters[2].value, json!(NO_STEP));
        assert_eq!(q.filters[3].value, json!(10_003.0));
    }

    #[test]
    fn push_batch_inserts_the_kept_points_with_owner() {
        let q = sent(push_batch(&call(
            batch_args(Value::Null),
            vec![Value::Null],
        )));
        assert_eq!(q.action, RepoAction::Insert);
        let body = q.body.unwrap();
        let steps: Vec<f64> = body
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["step"].as_f64().unwrap())
            .collect();
        assert_eq!(steps, [10_000.0, 10_003.0]);
        assert_eq!(body[0]["user_id"], "u1");
        assert_eq!(body[0]["metric"], "loss");
        assert_eq!(body[0]["experiment_id"], "e1");
        assert_eq!(body[1]["wall_time"], 12);
    }

    #[test]
    fn push_batch_drops_a_superseded_tip_softly_then_returns_the_cursor() {
        // A previous off-grid tip at 9 999.5 is no longer the newest point.
        let q = sent(push_batch(&call(
            batch_args(json!(9_999.5)),
            vec![Value::Null, Value::Null],
        )));
        assert_eq!(q.action, RepoAction::Delete);
        assert!(q.soft);
        assert_eq!(q.filters[2].column, "step");
        assert_eq!(q.filters[2].value, json!(9_999.5));
        let v = done(push_batch(&call(
            batch_args(json!(9_999.5)),
            vec![Value::Null; 3],
        )));
        assert_eq!(v, json!(10_003.0));
        // No superseded tip: done after the insert.
        let v = done(push_batch(&call(
            batch_args(Value::Null),
            vec![Value::Null; 2],
        )));
        assert_eq!(v, json!(10_003.0));
    }

    #[test]
    fn push_batch_fails_on_an_empty_batch_or_signed_out() {
        let mut args = batch_args(Value::Null);
        args[3] = json!([]);
        assert!(matches!(
            push_batch(&call(args, vec![])),
            RepoStep::Fail { .. }
        ));
        let mut c = call(batch_args(Value::Null), vec![]);
        c.ctx.user_id = None;
        assert!(matches!(push_batch(&c), RepoStep::Fail { .. }));
    }

    #[test]
    fn set_artifacts_updates_by_id() {
        let q = sent(set_artifacts(&call(
            vec![json!("e1"), json!(["u1/a.webp"])],
            vec![],
        )));
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(q.body.unwrap(), json!({ "artifacts": ["u1/a.webp"] }));
        assert_eq!(q.filters[0].value, "e1");
    }

    #[test]
    fn stale_artifact_ids_keeps_rows_naming_local_files() {
        let q = sent(stale_artifact_ids(&call(vec![json!(["e1", "e2"])], vec![])));
        assert_eq!(q.filters[0].op, "in");
        assert_eq!(q.filters[0].value, json!(["e1", "e2"]));
        let rows = json!([
            { "id": "e1", "artifacts": ["app://artifacts/e1/x/a.png"] },
            { "id": "e2", "artifacts": ["u1/e2/x/a.webp"] },
            { "id": "e3", "artifacts": null },
        ]);
        let v = done(stale_artifact_ids(&call(vec![json!(["e1"])], vec![rows])));
        assert_eq!(v, json!(["e1"]));
        let v = done(stale_artifact_ids(&call(
            vec![json!(["e1"])],
            vec![Value::Null],
        )));
        assert_eq!(v, json!([]));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}

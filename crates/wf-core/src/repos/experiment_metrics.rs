//! The `experiment_metrics` repository as Rust-planned queries.
//!
//! Ported from `PostgrestMetricRepository` in
//! `apps/web/src/features/experiments/infrastructure/parts.ts`. Reads and writes go to the
//! `experiment_metrics` view: writes route through its `INSTEAD OF INSERT` trigger, which
//! looks up the metric name, so the table itself must not be written. Rows map with
//! `metric_rows::to_domain`. The series is downsampled server-side by `metric_history`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::experiment_status::parse_iso_utc_ms;
use crate::metric_rows::{MetricRow, to_domain};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_rows};

const VIEW: &str = "experiment_metrics";

/// Rows per insert, so one request body stays bounded.
const INSERT_CHUNK: usize = 1000;

/// Experiment ids per `latest_metric_activity` call; a Postgres array parameter is bound as
/// one text literal, so the list stays short.
const IDS_PER_RPC: usize = 500;

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "append" => append(call),
        "history" => history(call),
        "latestActivityAt" => latest_activity_at(call),
        _ => return None,
    })
}

/// A `MetricPoint` as the caller sends it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PointIn {
    experiment_id: String,
    metric: String,
    step: f64,
    value: f64,
    wall_time: Option<String>,
}

/// A point as the view takes it. `user_id` is never sent: the trigger takes `auth.uid()`.
#[derive(Serialize)]
struct PointRow {
    experiment_id: String,
    metric: String,
    step: f64,
    value: f64,
    wall_time: Option<String>,
}

/// A `metric_history` row; the experiment id is not returned, the call supplies it.
#[derive(Deserialize)]
struct HistoryRow {
    metric: String,
    step: f64,
    value: f64,
    wall_time: Option<String>,
}

/// A `latest_metric_activity` row.
#[derive(Deserialize)]
struct ActivityRow {
    experiment_id: String,
    last_wall_time: Option<String>,
}

/// `append(points)`: inserts `INSERT_CHUNK` rows per request, one request at a time.
fn append(call: &RepoCall) -> RepoStep {
    let points: Vec<PointIn> = match call.parse(0) {
        Ok(points) => points,
        Err(e) => return RepoStep::fail(e),
    };
    let start = call.replies.len() * INSERT_CHUNK;
    if start >= points.len() {
        return RepoStep::unit();
    }
    let end = (start + INSERT_CHUNK).min(points.len());
    let rows: Vec<PointRow> = points[start..end]
        .iter()
        .map(|p| PointRow {
            experiment_id: p.experiment_id.clone(),
            metric: p.metric.clone(),
            step: p.step,
            value: p.value,
            wall_time: p.wall_time.clone(),
        })
        .collect();
    match serde_json::to_value(rows) {
        Ok(body) => RepoStep::send(RepoQuery::insert(VIEW, body)),
        Err(e) => RepoStep::fail(e),
    }
}

/// `history(experimentId, metric, budget)`: one bounded `metric_history` call.
fn history(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let args = json!({
            "p_experiment_id": call.text(0),
            "p_metric": call.arg(1),
            "p_max_points": call.arg(2).get("maxPoints").cloned().unwrap_or(Value::Null),
        });
        return RepoStep::send(RepoQuery::rpc("metric_history", args));
    }
    let experiment_id = call.text(0);
    map_rows(call, 0, |row: &HistoryRow| {
        to_domain(&MetricRow {
            experiment_id: experiment_id.to_string(),
            metric: row.metric.clone(),
            step: row.step,
            value: row.value,
            wall_time: row.wall_time.clone(),
        })
    })
}

/// `latestActivityAt(ids)`: the newest sample time per experiment in ms since the epoch,
/// as `[id, ms]` pairs sorted by id. Chunks are requested together and merged by max.
fn latest_activity_at(call: &RepoCall) -> RepoStep {
    let ids: Vec<String> = match call.parse(0) {
        Ok(ids) => ids,
        Err(e) => return RepoStep::fail(e),
    };
    let chunks: Vec<&[String]> = ids.chunks(IDS_PER_RPC).collect();
    if chunks.is_empty() {
        return RepoStep::done(&Vec::<(String, f64)>::new());
    }
    if call.replies.is_empty() {
        let queries = chunks
            .iter()
            .map(|chunk| {
                RepoQuery::rpc(
                    "latest_metric_activity",
                    json!({ "p_experiment_ids": chunk }),
                )
            })
            .collect();
        return RepoStep::Send { queries };
    }
    let mut newest: BTreeMap<String, f64> = BTreeMap::new();
    for i in 0..chunks.len() {
        let rows = match call.reply::<Vec<ActivityRow>>(i) {
            Some(Ok(rows)) => rows,
            Some(Err(e)) => return RepoStep::fail(e),
            None => return RepoStep::fail(format!("reply {i} missing")),
        };
        for row in rows {
            // A missing or unparseable time is skipped, as `Number.isFinite` skips NaN.
            let Some(ms) = row.last_wall_time.as_deref().and_then(parse_iso_utc_ms) else {
                continue;
            };
            if newest
                .get(&row.experiment_id)
                .is_some_and(|previous| *previous >= ms)
            {
                continue;
            }
            let _ = newest.insert(row.experiment_id, ms);
        }
    }
    let pairs: Vec<(String, f64)> = newest.into_iter().collect();
    RepoStep::done(&pairs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};

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

    fn point(i: usize) -> Value {
        json!({ "experimentId": "e1", "metric": "loss", "step": i, "value": 0.5 })
    }

    #[test]
    fn append_inserts_into_the_view_in_chunks_of_1000() {
        let points: Vec<Value> = (0..1001).map(point).collect();
        let first = sent(append(&call(vec![json!(points)], vec![])));
        assert_eq!(first.table, VIEW);
        assert_eq!(first.action, RepoAction::Insert);
        assert_eq!(
            first.body.as_ref().and_then(Value::as_array).map(Vec::len),
            Some(1000)
        );
        let second = sent(append(&call(vec![json!(points)], vec![Value::Null])));
        assert_eq!(
            second.body.as_ref().and_then(Value::as_array).map(Vec::len),
            Some(1)
        );
        assert_eq!(
            append(&call(vec![json!(points)], vec![Value::Null, Value::Null])),
            RepoStep::unit()
        );
    }

    #[test]
    fn append_maps_points_to_view_columns() {
        let q = sent(append(&call(
            vec![
                json!([{ "experimentId": "e1", "metric": "loss", "step": 2, "value": 0.5, "wallTime": "2026-04-01T10:00:00.000Z" }]),
            ],
            vec![],
        )));
        let body = q.body.expect("body");
        assert_eq!(body[0]["experiment_id"], "e1");
        assert_eq!(body[0]["wall_time"], "2026-04-01T10:00:00.000Z");
    }

    #[test]
    fn append_empty_sends_nothing() {
        assert_eq!(append(&call(vec![json!([])], vec![])), RepoStep::unit());
    }

    #[test]
    fn history_calls_metric_history_with_budget() {
        let q = sent(history(&call(
            vec![json!("e1"), Value::Null, json!({ "maxPoints": 500 })],
            vec![],
        )));
        assert_eq!(q.rpc.as_deref(), Some("metric_history"));
        let args = q.body.expect("args");
        assert_eq!(args["p_experiment_id"], "e1");
        assert_eq!(args["p_metric"], Value::Null);
        assert_eq!(args["p_max_points"], 500);
    }

    #[test]
    fn history_maps_rows_with_experiment_id_and_omits_missing_wall_time() {
        let v = done(history(&call(
            vec![json!("e1"), json!("loss"), json!({ "maxPoints": 500 })],
            vec![json!([
                { "metric": "loss", "step": 1.0, "value": 0.5, "wall_time": null },
                { "metric": "loss", "step": 2.0, "value": 0.4, "wall_time": "2026-04-01T10:00:00.000Z" }
            ])],
        )));
        assert_eq!(v[0]["experimentId"], "e1");
        assert!(v[0].get("wallTime").is_none());
        assert_eq!(v[1]["wallTime"], "2026-04-01T10:00:00.000Z");
    }

    #[test]
    fn latest_activity_empty_reads_nothing() {
        assert_eq!(
            done(latest_activity_at(&call(vec![json!([])], vec![]))),
            json!([])
        );
    }

    #[test]
    fn latest_activity_sends_500_id_chunks_together() {
        let ids: Vec<Value> = (0..501).map(|i| json!(format!("e{i}"))).collect();
        let queries = sent_all(latest_activity_at(&call(vec![json!(ids)], vec![])));
        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0].rpc.as_deref(), Some("latest_metric_activity"));
        let first = queries[0].body.as_ref().expect("args");
        assert_eq!(
            first["p_experiment_ids"].as_array().map(Vec::len),
            Some(500)
        );
    }

    #[test]
    fn latest_activity_keeps_the_newest_and_skips_missing_times() {
        let v = done(latest_activity_at(&call(
            vec![json!(["e1", "e2", "e3"])],
            vec![json!([
                { "experiment_id": "e1", "last_wall_time": "1970-01-01T00:00:01Z" },
                { "experiment_id": "e1", "last_wall_time": "1970-01-01T00:00:02.5Z" },
                { "experiment_id": "e2", "last_wall_time": null }
            ])],
        )));
        assert_eq!(v, json!([["e1", 2500.0]]));
    }
}

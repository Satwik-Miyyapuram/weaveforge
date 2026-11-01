//! The SDK metrics routes: `POST` stores a batch of points, `DELETE` drops one run's curves.
//! Port of `apps/web/src/app/api/sdk/metrics/{route,ingest,limits}.ts`.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Uri};
use axum::response::Response;
use serde_json::{Value, json};
use wf_core::experiments::plan_series_ingest;
use wf_core::sync::instant::format_instant;

use crate::postgrest::{UserDb, eq, in_list};
use crate::routes::AppState;
use crate::sdk::{
    caller, db_failure, error_response, json_response, parse_body, query_param, user_db,
};

/// Most points one request may carry.
pub const MAX_POINTS_PER_REQUEST: usize = 5000;
/// Most distinct `(experiment, metric)` series one request may carry.
pub const MAX_SERIES_PER_REQUEST: usize = 200;

/// Rows to insert and stale tips to clear, from one batch.
struct Batch {
    rows: Vec<Value>,
    stale_tips: Vec<StaleTip>,
}

/// An off-grid tip left by an earlier batch, one per series at most.
struct StaleTip {
    experiment_id: String,
    metric: String,
    step: f64,
}

/// Stores one batch of points, downsampled per series (the body of `POST`).
pub async fn metrics_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let user = match caller(&state, &headers).await {
        Ok(user) => user,
        Err(response) => return response,
    };
    let db = user_db(&state, &user);
    ingest_metrics(&db, parse_body(&body), now_ms()).await
}

/// Drops one run's stored curves, so a run re-used by key starts empty.
pub async fn metrics_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let user = match caller(&state, &headers).await {
        Ok(user) => user,
        Err(response) => return response,
    };
    let Some(experiment_id) = query_param(&uri, "experiment_id") else {
        return error_response(400, "Missing experiment_id.");
    };
    let db = user_db(&state, &user);
    for table in ["experiment_metric_points", "experiment_metric_chunks"] {
        if let Err(err) = db
            .delete(table, &[("experiment_id", eq(&experiment_id))])
            .await
        {
            return db_failure(&err, "sdk-metrics");
        }
    }
    json_response(200, &json!({"ok": true}))
}

/// Validate, downsample and store one SDK metrics batch.
pub async fn ingest_metrics(db: &UserDb<'_>, body: Option<Value>, now_ms: i64) -> Response {
    let points = match validate(body) {
        Ok(points) => points,
        Err(response) => return response,
    };
    if points.is_empty() {
        return json_response(200, &json!({"ok": true}));
    }
    let received = points.len();
    let ids = experiment_ids(&points);
    let batch = match plan_batch(db, points).await {
        Ok(batch) => batch,
        Err(response) => return response,
    };
    let stored = batch.rows.len();
    if stored > 0
        && let Err(err) = db
            .insert("experiment_metrics", &Value::Array(batch.rows))
            .await
    {
        return db_failure(&err, "sdk-metrics");
    }
    // After the insert, so a failed insert leaves the stored curve untouched.
    for tip in batch.stale_tips {
        let query = [
            ("experiment_id", eq(&tip.experiment_id)),
            ("metric", eq(&tip.metric)),
            ("step", eq(&tip.step.to_string())),
        ];
        if let Err(err) = db.delete("experiment_metrics", &query).await {
            eprintln!(
                "[sdk-metrics] stale tip delete failed for step {}: {}",
                tip.step, err.message
            );
        }
    }
    if !ids.is_empty() {
        // Heartbeat: metric streams keep the run alive; revive wrongly-abandoned live SDK runs.
        let query = [
            ("id", in_list(&ids)),
            ("status", "in.(\"running\",\"abandoned\")".to_string()),
        ];
        let patch = json!({"started_at": format_instant(now_ms), "status": "running"});
        // A failed heartbeat must not fail a batch that is already stored.
        let _ = db.update("experiments", &query, &patch).await;
    }
    json_response(
        200,
        &json!({"ok": true, "received": received, "stored": stored}),
    )
}

/// Checks the body shape and the point count, and hands back the points.
fn validate(body: Option<Value>) -> Result<Vec<Value>, Response> {
    let Some(body) = body else {
        return Err(error_response(400, "Invalid JSON body."));
    };
    let Some(Value::Array(points)) = take_points(body) else {
        return Err(error_response(400, "Body must be { points: [...] }."));
    };
    if points.len() > MAX_POINTS_PER_REQUEST {
        return Err(error_response(
            400,
            &format!("At most {MAX_POINTS_PER_REQUEST} points per request."),
        ));
    }
    // Each point is read as an object later; anything else would be a client mistake.
    if !points.iter().all(Value::is_object) {
        return Err(error_response(400, "Every point must be an object."));
    }
    Ok(points)
}

fn take_points(body: Value) -> Option<Value> {
    match body {
        Value::Object(mut map) => map.remove("points"),
        _ => None,
    }
}

/// The distinct non-empty experiment ids in a batch, in first-seen order.
fn experiment_ids(points: &[Value]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for id in points
        .iter()
        .filter_map(|p| p.get("experiment_id").and_then(Value::as_str))
    {
        let id = id.trim();
        if !id.is_empty() && seen.insert(id) {
            ids.push(id.to_string());
        }
    }
    ids
}

/// Groups the points by series, refusing a batch that spans too many.
fn group_by_series(points: Vec<Value>) -> Result<Vec<Vec<Value>>, Response> {
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut groups: Vec<Vec<Value>> = Vec::new();
    for point in points {
        // NUL separates the two parts: a metric name is free text, a run id is not.
        let key = format!(
            "{}\u{0}{}",
            js_string(point.get("experiment_id")),
            js_string(point.get("metric"))
        );
        let next = groups.len();
        let i = *index.entry(key).or_insert(next);
        if i == next {
            groups.push(Vec::new());
        }
        groups[i].push(point);
    }
    if groups.len() > MAX_SERIES_PER_REQUEST {
        return Err(error_response(
            400,
            &format!("At most {MAX_SERIES_PER_REQUEST} distinct series per request."),
        ));
    }
    Ok(groups)
}

async fn plan_batch(db: &UserDb<'_>, points: Vec<Value>) -> Result<Batch, Response> {
    let mut batch = Batch {
        rows: Vec::new(),
        stale_tips: Vec::new(),
    };
    for series in group_by_series(points)? {
        plan_series(db, series, &mut batch).await?;
    }
    Ok(batch)
}

/// Downsamples one series against its stored tip and adds the kept points to `batch`.
async fn plan_series(
    db: &UserDb<'_>,
    series: Vec<Value>,
    batch: &mut Batch,
) -> Result<(), Response> {
    let Some(first) = series.first() else {
        return Ok(());
    };
    // Unattributed points cannot be grouped into a series, so they pass through unchanged.
    if !is_truthy(first.get("experiment_id")) || !is_truthy(first.get("metric")) {
        batch.rows.extend(series);
        return Ok(());
    }
    let experiment_id = js_string(first.get("experiment_id"));
    let metric = js_string(first.get("metric"));
    let steps = read_steps(&series)?;
    let stored = highest_stored_step(db, &experiment_id, &metric).await?;
    let decision = plan_series_ingest(&steps, stored);
    for i in decision.keep {
        if let (Some(point), Some(&step)) = (series.get(i), steps.get(i)) {
            let mut row = point.clone();
            row["step"] = js_number_value(step);
            batch.rows.push(row);
        }
    }
    if let Some(step) = decision.superseded_tip_step {
        batch.stale_tips.push(StaleTip {
            experiment_id,
            metric,
            step,
        });
    }
    Ok(())
}

/// Each point's step as a number; a step that is not finite is refused.
fn read_steps(series: &[Value]) -> Result<Vec<f64>, Response> {
    let mut steps = Vec::with_capacity(series.len());
    for point in series {
        let step = js_number(point.get("step"));
        if !step.is_finite() {
            let text = json_text(point.get("step"));
            return Err(error_response(
                400,
                &format!("Point step must be a finite number, got {text}."),
            ));
        }
        steps.push(step);
    }
    Ok(steps)
}

/// The highest step already stored for a series, or None when it is new.
async fn highest_stored_step(
    db: &UserDb<'_>,
    experiment_id: &str,
    metric: &str,
) -> Result<Option<f64>, Response> {
    let query = [
        ("select", "step".to_string()),
        ("experiment_id", eq(experiment_id)),
        ("metric", eq(metric)),
        ("order", "step.desc".to_string()),
        ("limit", "1".to_string()),
    ];
    let rows = db
        .select("experiment_metrics", &query)
        .await
        .map_err(|err| db_failure(&err, "sdk-metrics"))?;
    Ok(rows
        .first()
        .and_then(|row| row.get("step"))
        .map(|step| js_number(Some(step)))
        .filter(|step| step.is_finite()))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// JS `String(x ?? "")` for a field read off a point.
fn js_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

/// JS `Number(x ?? 0)` for a step; text that is not a number becomes NaN.
fn js_number(value: Option<&Value>) -> f64 {
    match value {
        None | Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let text = s.trim();
            if text.is_empty() {
                0.0
            } else {
                text.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        Some(_) => f64::NAN,
    }
}

/// JS truthiness of a field read off a point.
fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// The JSON text of a field; a missing one reads as `null`.
fn json_text(value: Option<&Value>) -> String {
    value.map_or_else(|| "null".to_owned(), Value::to_string)
}

/// A stored step as JSON, so `5.0` is sent as `5`.
fn js_number_value(step: f64) -> Value {
    serde_json::from_str(&step.to_string()).unwrap_or(Value::Null)
}

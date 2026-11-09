//! Experiment status and metric helpers for JavaScript (wf-core `experiment_status`). The JS names
//! match `packages/core/src/features/experiments/domain/experiment.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::experiment_status::{self, Experiment, ExperimentStatus};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Any JS value as JSON. `undefined`, functions and symbols read as `null`.
fn json_from(raw: JsValue) -> JsResult<serde_json::Value> {
    if raw.is_undefined() {
        return Ok(serde_json::Value::Null);
    }
    serde_wasm_bindgen::from_value(raw)
}

/// [`status_patch_for_experiment`](experiment_status::status_patch_for_experiment).
///
/// # Errors
///
/// Fails if `experiment` or `status` has the wrong shape.
#[wasm_bindgen(js_name = statusPatchForExperiment)]
pub fn status_patch_for_experiment_js(
    experiment: JsValue,
    status: JsValue,
    now: &str,
) -> JsResult<JsValue> {
    let experiment: Experiment = serde_wasm_bindgen::from_value(experiment)?;
    let status: ExperimentStatus = serde_wasm_bindgen::from_value(status)?;
    to_js(&experiment_status::status_patch_for_experiment(
        &experiment,
        status,
        now,
    ))
}

/// [`short_sha`](experiment_status::short_sha); `undefined` when absent or empty.
#[wasm_bindgen(js_name = shortSha)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn short_sha_js(sha: Option<String>) -> Option<String> {
    experiment_status::short_sha(sha.as_deref())
}

/// [`experiment_activity_at`](experiment_status::experiment_activity_at).
///
/// # Errors
///
/// Fails if `experiment` has the wrong shape.
#[wasm_bindgen(js_name = experimentActivityAt)]
pub fn experiment_activity_at_js(experiment: JsValue) -> JsResult<f64> {
    let experiment: Experiment = serde_wasm_bindgen::from_value(experiment)?;
    Ok(experiment_status::experiment_activity_at(&experiment))
}

/// [`is_stale_running_experiment`](experiment_status::is_stale_running_experiment); `undefined` last metric time means none.
///
/// # Errors
///
/// Fails if `experiment` has the wrong shape.
#[wasm_bindgen(js_name = isStaleRunningExperiment)]
pub fn is_stale_running_experiment_js(
    experiment: JsValue,
    now_ms: f64,
    stale_ms: f64,
    last_metric_at_ms: Option<f64>,
) -> JsResult<bool> {
    let experiment: Experiment = serde_wasm_bindgen::from_value(experiment)?;
    Ok(experiment_status::is_stale_running_experiment(
        &experiment,
        now_ms,
        stale_ms,
        last_metric_at_ms,
    ))
}

/// [`format_metric_value`](experiment_status::format_metric_value).
#[wasm_bindgen(js_name = formatMetricValue)]
pub fn format_metric_value_js(metric: &str, value: f64) -> String {
    experiment_status::format_metric_value(metric, value)
}

/// [`format_metric_cell`](experiment_status::format_metric_cell).
///
/// # Errors
///
/// Fails if `value` cannot be read as JSON.
#[wasm_bindgen(js_name = formatMetricCell)]
pub fn format_metric_cell_js(metric: &str, value: JsValue) -> JsResult<String> {
    let value = json_from(value)?;
    Ok(experiment_status::format_metric_cell(metric, &value))
}

/// [`metric_keys`](experiment_status::metric_keys): the metric names across runs, in UTF-16 order.
///
/// # Errors
///
/// Fails if `experiments` is not an array of run objects.
#[wasm_bindgen(js_name = metricKeys)]
pub fn metric_keys_js(experiments: JsValue) -> JsResult<JsValue> {
    let experiments: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(experiments)?;
    to_js(&experiment_status::metric_keys(&experiments))
}

/// [`results_table`](experiment_status::results_table): the header and rows of the runs table.
///
/// # Errors
///
/// Fails if `experiments` is not an array of run objects, or the result cannot be serialised.
#[wasm_bindgen(js_name = resultsTable)]
pub fn results_table_js(experiments: JsValue) -> JsResult<JsValue> {
    let experiments: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(experiments)?;
    to_js(&experiment_status::results_table(&experiments))
}

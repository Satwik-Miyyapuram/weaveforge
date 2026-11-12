//! Experiment status and metric helpers for JavaScript (wf-core `experiment_status`). The JS names
//! match `packages/core/src/features/experiments/domain/parts.ts`.

use js_sys::{BigInt, JSON, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::experiment_status::{self, Experiment, ExperimentStatus, STALE_RUNNING_MS};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Any JS value as JSON. `undefined`, functions and symbols read as `null`.
fn json_from(raw: JsValue) -> JsResult<serde_json::Value> {
    if raw.is_undefined() {
        return Ok(serde_json::Value::Null);
    }
    serde_wasm_bindgen::from_value(raw)
}

/// [`status_patch_for_experiment`](experiment_status::status_patch_for_experiment). Every key is
/// present (a missing stamp is `undefined`), so spreading the patch clears a stamp.
///
/// # Errors
///
/// Fails if `experiment` or `status` has the wrong shape.
#[wasm_bindgen(
    js_name = statusPatchForExperiment,
    unchecked_return_type = "B.ExperimentStatusPatch"
)]
pub fn status_patch_for_experiment_js(
    #[wasm_bindgen(unchecked_param_type = "B.Experiment")] experiment: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ExperimentStatus")] status: JsValue,
    now: &str,
) -> JsResult<JsValue> {
    let experiment: Experiment = serde_wasm_bindgen::from_value(experiment)?;
    let status: ExperimentStatus = serde_wasm_bindgen::from_value(status)?;
    let patch = experiment_status::status_patch_for_experiment(&experiment, status, now);
    let out = Object::new();
    let set = |key: &str, value: &JsValue| {
        Reflect::set(&out, &JsValue::from_str(key), value)
            .map(drop)
            .map_err(|_| serde_wasm_bindgen::Error::new("cannot build the status patch"))
    };
    set("status", &to_js(&patch.status)?)?;
    set("startedAt", &JsValue::from(patch.started_at))?;
    set("finishedAt", &JsValue::from(patch.finished_at))?;
    Ok(out.into())
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
pub fn experiment_activity_at_js(
    #[wasm_bindgen(unchecked_param_type = "B.Experiment")] experiment: JsValue,
) -> JsResult<f64> {
    let experiment: Experiment = serde_wasm_bindgen::from_value(experiment)?;
    Ok(experiment_status::experiment_activity_at(&experiment))
}

/// [`is_stale_running_experiment`](experiment_status::is_stale_running_experiment); `undefined` last
/// metric time means none. `nowMs` defaults to `Date.now()`, `staleMs` to [`STALE_RUNNING_MS`].
///
/// # Errors
///
/// Fails if `experiment` has the wrong shape.
#[wasm_bindgen(js_name = isStaleRunningExperiment)]
pub fn is_stale_running_experiment_js(
    #[wasm_bindgen(unchecked_param_type = "B.Experiment")] experiment: JsValue,
    now_ms: Option<f64>,
    stale_ms: Option<f64>,
    last_metric_at_ms: Option<f64>,
) -> JsResult<bool> {
    let experiment: Experiment = serde_wasm_bindgen::from_value(experiment)?;
    Ok(experiment_status::is_stale_running_experiment(
        &experiment,
        now_ms.unwrap_or_else(js_sys::Date::now),
        stale_ms.unwrap_or(STALE_RUNNING_MS),
        last_metric_at_ms,
    ))
}

/// [`format_metric_value`](experiment_status::format_metric_value).
#[wasm_bindgen(js_name = formatMetricValue)]
pub fn format_metric_value_js(metric: &str, value: f64) -> String {
    experiment_status::format_metric_value(metric, value)
}

/// [`format_metric_cell`](experiment_status::format_metric_cell): one metric's value as text, for a
/// chip or a table cell. A bigint shows as `String(bigint)`. An object, function or symbol first
/// goes through `JSON.stringify` (its `toJSON`, dropped `undefined`s); a cycle or an unrepresentable
/// value shows "—", and a `toJSON` that returned a primitive shows the JSON text itself.
///
/// # Errors
///
/// Fails if `value` cannot be read as JSON.
#[wasm_bindgen(js_name = formatMetricCell)]
pub fn format_metric_cell_js(
    metric: &str,
    #[wasm_bindgen(unchecked_param_type = "unknown")] value: JsValue,
) -> JsResult<String> {
    if value.is_bigint() {
        return value
            .unchecked_into::<BigInt>()
            .to_string(10)
            .map(String::from)
            .map_err(|_| serde_wasm_bindgen::Error::new("cannot format a bigint"));
    }
    if value.is_object() || value.is_function() || value.is_symbol() {
        let Ok(json) = JSON::stringify(&value) else {
            return Ok("\u{2014}".to_owned());
        };
        let Some(json) = json.as_string() else {
            return Ok("\u{2014}".to_owned());
        };
        let plain = JSON::parse(&json)
            .map_err(|_| serde_wasm_bindgen::Error::new("cannot read the metric JSON"))?;
        if !plain.is_object() {
            return Ok(json);
        }
        return Ok(experiment_status::format_metric_cell(
            metric,
            &json_from(plain)?,
        ));
    }
    let value = json_from(value)?;
    Ok(experiment_status::format_metric_cell(metric, &value))
}

/// [`metric_keys`](experiment_status::metric_keys): the metric names across runs, in UTF-16 order.
///
/// # Errors
///
/// Fails if `experiments` is not an array of run objects.
#[wasm_bindgen(js_name = metricKeys, unchecked_return_type = "string[]")]
pub fn metric_keys_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.Experiment[]")] experiments: JsValue,
) -> JsResult<JsValue> {
    let experiments: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(experiments)?;
    to_js(&experiment_status::metric_keys(&experiments))
}

/// [`metric_keys`](experiment_status::metric_keys) under its `parts.ts` name: every metric name any
/// of the runs logged, sorted by UTF-16 code units.
///
/// # Errors
///
/// Fails if `experiments` is not an array of run objects.
#[wasm_bindgen(js_name = metricKeysOf, unchecked_return_type = "string[]")]
pub fn metric_keys_of_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.Experiment[]")] experiments: JsValue,
) -> JsResult<JsValue> {
    metric_keys_js(experiments)
}

/// [`results_table`](experiment_status::results_table): the header and rows of the runs table.
///
/// # Errors
///
/// Fails if `experiments` is not an array of run objects, or the result cannot be serialised.
#[wasm_bindgen(js_name = resultsTable, unchecked_return_type = "B.ResultsTable")]
pub fn results_table_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.Experiment[]")] experiments: JsValue,
) -> JsResult<JsValue> {
    let experiments: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(experiments)?;
    to_js(&experiment_status::results_table(&experiments))
}

/// [`experiment_href`](experiment_status::experiment_href): where an experiment opens.
#[wasm_bindgen(js_name = experimentHref)]
#[must_use]
pub fn experiment_href_js(id: &str, is_offline_build: bool) -> String {
    experiment_status::experiment_href(id, is_offline_build)
}

/// [`EXPERIMENTS_HREF`](experiment_status::EXPERIMENTS_HREF): the experiments list.
#[wasm_bindgen(js_name = experimentsListHref)]
#[must_use]
pub fn experiments_list_href_js() -> String {
    experiment_status::EXPERIMENTS_HREF.to_owned()
}

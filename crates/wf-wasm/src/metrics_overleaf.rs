//! Metric downsampling and Overleaf link rules for JavaScript (wf-core `experiments`, `overleaf`).

use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::{experiments, overleaf};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`stride_for_step`](experiments::stride_for_step).
#[wasm_bindgen(js_name = strideForStep)]
#[must_use]
pub fn stride_for_step_js(step: f64) -> f64 {
    experiments::stride_for_step(step)
}

/// [`is_on_sampling_grid`](experiments::is_on_sampling_grid).
#[wasm_bindgen(js_name = isOnSamplingGrid)]
#[must_use]
pub fn is_on_sampling_grid_js(step: f64) -> bool {
    experiments::is_on_sampling_grid(step)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IngestPlan {
    keep: Vec<usize>,
    superseded_tip_step: Option<f64>,
}

/// [`plan_series_ingest`](experiments::plan_series_ingest): `{ keep: indices, supersededTipStep }`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = planSeriesIngestIndices)]
pub fn plan_series_ingest_js(steps: &[f64], previous_max_step: Option<f64>) -> JsResult<JsValue> {
    let plan = experiments::plan_series_ingest(steps, previous_max_step);
    to_js(&IngestPlan {
        keep: plan.keep,
        superseded_tip_step: plan.superseded_tip_step,
    })
}

/// [`steps_to_prune`](experiments::steps_to_prune).
#[wasm_bindgen(js_name = stepsToPrune)]
#[must_use]
pub fn steps_to_prune_js(stored_steps: &[f64]) -> Vec<f64> {
    experiments::steps_to_prune(stored_steps)
}

/// [`is_valid_project_id`](overleaf::is_valid_project_id).
#[wasm_bindgen(js_name = isOverleafProjectId)]
#[must_use]
pub fn is_overleaf_project_id_js(id: &str) -> bool {
    overleaf::is_valid_project_id(id)
}

/// [`entry_file_error`](overleaf::entry_file_error).
#[wasm_bindgen(js_name = entryFileError)]
#[must_use]
pub fn entry_file_error_js(entry_file: &str) -> Option<String> {
    overleaf::entry_file_error(entry_file).map(str::to_owned)
}

/// [`parse_overleaf_project_id`](overleaf::parse_overleaf_project_id).
#[wasm_bindgen(js_name = parseOverleafProjectId)]
#[must_use]
pub fn parse_overleaf_project_id_js(raw: &str) -> Option<String> {
    overleaf::parse_overleaf_project_id(raw)
}

/// [`overleaf_git_url`](overleaf::overleaf_git_url).
#[wasm_bindgen(js_name = overleafGitUrl)]
#[must_use]
pub fn overleaf_git_url_js(id: &str) -> String {
    overleaf::overleaf_git_url(id)
}

/// [`external_url`](overleaf::external_url).
#[wasm_bindgen(js_name = overleafExternalUrl)]
#[must_use]
pub fn overleaf_external_url_js(id: &str) -> String {
    overleaf::external_url(id)
}

/// [`sanitize_section_targets`](overleaf::sanitize_section_targets); `null` when malformed.
///
/// # Errors
///
/// Fails if `input` cannot be read as JSON.
#[wasm_bindgen(js_name = sanitizeSectionTargets)]
pub fn sanitize_section_targets_js(input: JsValue) -> JsResult<JsValue> {
    if input.is_undefined() {
        return Ok(JsValue::NULL);
    }
    let value: serde_json::Value = serde_wasm_bindgen::from_value(input)?;
    match overleaf::sanitize_section_targets(&value) {
        Some(map) => to_js(&map),
        None => Ok(JsValue::NULL),
    }
}

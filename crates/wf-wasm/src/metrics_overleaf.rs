//! Metric downsampling and Overleaf link rules for JavaScript (wf-core `experiments`, `overleaf`).

use js_sys::{Array, Object, Reflect};
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
#[wasm_bindgen(
    js_name = planSeriesIngestIndices,
    unchecked_return_type = "{ keep: number[]; supersededTipStep: number | null }"
)]
pub fn plan_series_ingest_js(steps: &[f64], previous_max_step: Option<f64>) -> JsResult<JsValue> {
    let plan = experiments::plan_series_ingest(steps, previous_max_step);
    to_js(&IngestPlan {
        keep: plan.keep,
        superseded_tip_step: plan.superseded_tip_step,
    })
}

/// The generic signature of [`plan_series_ingest_points_js`], which wasm-bindgen cannot express.
#[wasm_bindgen(typescript_custom_section)]
const PLAN_SERIES_INGEST_TS: &str = r"
/** What to store for one series: grid points plus the newest, and a superseded tip to delete. */
export function planSeriesIngest<T extends { step: number }>(
  points: readonly T[],
  previousMaxStep: number | null,
): { keep: T[]; supersededTipStep: number | null };
";

/// What to store for one series: the caller's grid points plus the newest (the same
/// objects, in order), and a superseded tip to delete. Each point's `step` is read as a
/// number (`NaN` when it is not one).
///
/// # Errors
///
/// Fails if a point's `step` cannot be read, or the plan cannot be converted to JS.
#[wasm_bindgen(js_name = planSeriesIngest, skip_typescript)]
pub fn plan_series_ingest_points_js(
    points: &Array,
    previous_max_step: Option<f64>,
) -> Result<JsValue, JsValue> {
    let step_key = JsValue::from_str("step");
    let steps = points
        .iter()
        .map(|point| {
            Ok(Reflect::get(&point, &step_key)?
                .as_f64()
                .unwrap_or(f64::NAN))
        })
        .collect::<Result<Vec<f64>, JsValue>>()?;
    let plan = experiments::plan_series_ingest(&steps, previous_max_step);
    let keep: Array = plan
        .keep
        .iter()
        .map(|&i| points.get(u32::try_from(i).unwrap_or(u32::MAX)))
        .collect();
    let out = Object::new();
    let _ = Reflect::set(&out, &JsValue::from_str("keep"), &keep)?;
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("supersededTipStep"),
        &plan
            .superseded_tip_step
            .map_or(JsValue::NULL, JsValue::from_f64),
    )?;
    Ok(out.into())
}

/// [`steps_to_prune`](experiments::steps_to_prune): steps to delete from a stored series,
/// off-grid steps except the newest.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = stepsToPrune, unchecked_return_type = "number[]")]
pub fn steps_to_prune_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] stored_steps: &[f64],
) -> JsResult<JsValue> {
    to_js(&experiments::steps_to_prune(stored_steps))
}

/// [`is_valid_project_id`](overleaf::is_valid_project_id).
#[wasm_bindgen(js_name = isOverleafProjectId)]
#[must_use]
pub fn is_overleaf_project_id_js(id: &str) -> bool {
    overleaf::is_valid_project_id(id)
}

/// [`entry_file_error`](overleaf::entry_file_error): the message for an unsafe entry file
/// path, or `null`.
#[wasm_bindgen(js_name = entryFileError, unchecked_return_type = "string | null")]
#[must_use]
pub fn entry_file_error_js(entry_file: &str) -> JsValue {
    overleaf::entry_file_error(entry_file).map_or(JsValue::NULL, JsValue::from_str)
}

/// [`parse_overleaf_project_id`](overleaf::parse_overleaf_project_id): the project id from a
/// pasted id, project page or git URL; `null` otherwise.
#[wasm_bindgen(js_name = parseOverleafProjectId, unchecked_return_type = "string | null")]
#[must_use]
pub fn parse_overleaf_project_id_js(raw: &str) -> JsValue {
    overleaf::parse_overleaf_project_id(raw).map_or(JsValue::NULL, |id| JsValue::from_str(&id))
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
#[wasm_bindgen(
    js_name = sanitizeSectionTargets,
    unchecked_return_type = "Record<string, number> | null"
)]
pub fn sanitize_section_targets_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
) -> JsResult<JsValue> {
    if input.is_undefined() {
        return Ok(JsValue::NULL);
    }
    let value: serde_json::Value = serde_wasm_bindgen::from_value(input)?;
    match overleaf::sanitize_section_targets(&value) {
        Some(map) => to_js(&map),
        None => Ok(JsValue::NULL),
    }
}

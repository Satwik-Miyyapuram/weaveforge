//! Milestone domain rules for JavaScript (wf-core `plan::milestone`). The JS names match
//! `packages/core/src/features/plan/domain/milestone.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::plan::milestone::{self, ComputeNeed, MilestoneDependency, NewMilestoneInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_iso_day`](milestone::is_iso_day).
#[wasm_bindgen(js_name = isIsoDay)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn is_iso_day_js(value: String) -> bool {
    milestone::is_iso_day(&value)
}

/// [`iso_day_from_parts`](milestone::iso_day_from_parts): `month` is 1-based.
#[wasm_bindgen(js_name = isoDayFromParts)]
#[must_use]
pub fn iso_day_from_parts_js(year: i32, month: u32, day: u32) -> String {
    milestone::iso_day_from_parts(year, month, day)
}

/// [`validate_dependencies`](milestone::validate_dependencies): the validation message, or
/// `undefined` when the list is valid.
///
/// # Errors
///
/// Fails if `deps` has the wrong shape.
#[wasm_bindgen(js_name = validateDependenciesError)]
pub fn validate_dependencies_error_js(
    #[wasm_bindgen(unchecked_param_type = "B.MilestoneDependency[]")] deps: JsValue,
) -> JsResult<Option<String>> {
    let deps: Vec<MilestoneDependency> = serde_wasm_bindgen::from_value(deps)?;
    Ok(milestone::validate_dependencies(&deps).err())
}

/// [`validate_compute`](milestone::validate_compute): the validation message, or `undefined`
/// when the list is valid.
///
/// # Errors
///
/// Fails if `compute` has the wrong shape.
#[wasm_bindgen(js_name = validateComputeError)]
pub fn validate_compute_error_js(
    #[wasm_bindgen(unchecked_param_type = "B.ComputeNeed[]")] compute: JsValue,
) -> JsResult<Option<String>> {
    let compute: Vec<ComputeNeed> = serde_wasm_bindgen::from_value(compute)?;
    Ok(milestone::validate_compute(&compute).err())
}

/// [`validate_new_milestone`](milestone::validate_new_milestone): the validation message, or
/// `undefined` when the input is valid.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = milestoneInputError)]
pub fn milestone_input_error_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewMilestoneInput")] input: JsValue,
) -> JsResult<Option<String>> {
    let input: NewMilestoneInput = serde_wasm_bindgen::from_value(input)?;
    Ok(milestone::validate_new_milestone(&input).err())
}

/// [`create_milestone`](milestone::create_milestone) with the id and time supplied. Call
/// [`milestone_input_error_js`] first: invalid input fails here.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or is invalid.
#[wasm_bindgen(js_name = createMilestoneWith, unchecked_return_type = "B.Milestone")]
pub fn create_milestone_with_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewMilestoneInput")] input: JsValue,
    id: &str,
    created_at: &str,
) -> JsResult<JsValue> {
    let input: NewMilestoneInput = serde_wasm_bindgen::from_value(input)?;
    let made = milestone::create_milestone(&input, id, created_at)
        .map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&made)
}

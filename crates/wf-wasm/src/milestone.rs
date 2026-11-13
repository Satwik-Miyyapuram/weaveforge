//! Milestone domain rules for JavaScript (wf-core `plan::milestone`). The JS names match
//! `packages/core/src/features/plan/domain/parts.ts`.

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

/// A JS `Error` named `MilestoneValidationError` carrying `message`.
fn validation_error(message: &str) -> JsValue {
    let error = js_sys::Error::new(message);
    error.set_name("MilestoneValidationError");
    error.into()
}

/// [`validate_dependencies`](milestone::validate_dependencies), throwing on an invalid list.
///
/// # Errors
///
/// Throws a `MilestoneValidationError` with the validation message, or a shape error if
/// `deps` has the wrong shape.
#[wasm_bindgen(js_name = validateDependencies)]
pub fn validate_dependencies_js(
    #[wasm_bindgen(unchecked_param_type = "B.MilestoneDependency[]")] deps: JsValue,
) -> Result<(), JsValue> {
    let deps: Vec<MilestoneDependency> = serde_wasm_bindgen::from_value(deps)?;
    milestone::validate_dependencies(&deps).map_err(|message| validation_error(&message))
}

/// [`validate_compute`](milestone::validate_compute), throwing on an invalid list.
///
/// # Errors
///
/// Throws a `MilestoneValidationError` with the validation message, or a shape error if
/// `compute` has the wrong shape.
#[wasm_bindgen(js_name = validateCompute)]
pub fn validate_compute_js(
    #[wasm_bindgen(unchecked_param_type = "B.ComputeNeed[]")] compute: JsValue,
) -> Result<(), JsValue> {
    let compute: Vec<ComputeNeed> = serde_wasm_bindgen::from_value(compute)?;
    milestone::validate_compute(&compute).map_err(|message| validation_error(&message))
}

/// Calls `owner[key][method]()` with `this` = `owner[key]` and returns its result.
fn call_dep(owner: &JsValue, key: &str, method: &str) -> Result<JsValue, JsValue> {
    let target = js_sys::Reflect::get(owner, &JsValue::from_str(key))?;
    let function: js_sys::Function =
        wasm_bindgen::JsCast::dyn_into(js_sys::Reflect::get(&target, &JsValue::from_str(method))?)
            .map_err(|_| js_sys::TypeError::new(&format!("{key}.{method} is not a function")))?;
    function.call0(&target)
}

/// A new milestone from caller input: validates first (so no id is drawn for bad input),
/// then calls `deps.ids.newId()` and `deps.clock.nowIso()` in that order.
///
/// # Errors
///
/// Throws a `MilestoneValidationError` for invalid input, a shape error for a malformed
/// `input`, or whatever `newId` / `nowIso` throw.
#[wasm_bindgen(js_name = createMilestone, unchecked_return_type = "B.Milestone")]
pub fn create_milestone_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewMilestoneInput")] input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ clock: { nowIso(): string }; ids: { newId(): string } }"
    )]
    deps: &JsValue,
) -> Result<JsValue, JsValue> {
    let parsed: NewMilestoneInput = serde_wasm_bindgen::from_value(input.clone())?;
    if let Err(message) = milestone::validate_new_milestone(&parsed) {
        return Err(validation_error(&message));
    }
    let id = call_dep(deps, "ids", "newId")?;
    let now = call_dep(deps, "clock", "nowIso")?;
    let id = id
        .as_string()
        .ok_or_else(|| js_sys::TypeError::new("newId() must return a string"))?;
    let now = now
        .as_string()
        .ok_or_else(|| js_sys::TypeError::new("nowIso() must return a string"))?;
    Ok(create_milestone_with_js(input, &id, &now)?)
}

//! Milestone row mapping for JavaScript (wf-core `plan::milestone_row`). The TS wrapper in
//! `packages/wf-wasm/src/milestone-rows.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::plan::milestone::Milestone;
use wf_core::plan::milestone_row::{MilestoneRow, to_milestone, to_row};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_milestone`]: a `milestones` row as the app's milestone.
#[wasm_bindgen(js_name = milestoneFromRow, unchecked_return_type = "B.Milestone")]
pub fn milestone_from_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.MilestoneRowInput")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: MilestoneRow = parse(row)?;
    to_js(&to_milestone(&row)).map_err(js_error)
}

/// [`to_row`]: a milestone as the `milestones` row it is written as.
#[wasm_bindgen(js_name = milestoneToRow, unchecked_return_type = "B.MilestoneWriteRow")]
pub fn milestone_to_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.Milestone")] milestone: JsValue,
) -> Result<JsValue, JsError> {
    let milestone: Milestone = parse(milestone)?;
    to_js(&to_row(&milestone)).map_err(js_error)
}

//! Plan screen ordering and summary text for JavaScript (wf-core `plan::screen`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::plan::milestone::Milestone;
use wf_core::plan::screen;

use super::to_js;

/// [`sort_by_due`](screen::sort_by_due): dated milestones soonest first, undated after.
///
/// # Errors
///
/// Fails if `milestones` has the wrong shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = sortByDue)]
pub fn sort_by_due_js(milestones: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let milestones: Vec<Milestone> = serde_wasm_bindgen::from_value(milestones)?;
    to_js(&screen::sort_by_due(&milestones))
}

/// [`plan_eyebrow`](screen::plan_eyebrow): the line above the plan title, or `undefined` for none.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = planEyebrow)]
pub fn plan_eyebrow_js(total: u32, done: u32) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&screen::plan_eyebrow(total, done))
}

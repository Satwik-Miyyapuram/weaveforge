//! Milestone dependency chip target for JavaScript (wf-core `plan::chip`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::plan::chip::{self, ChipMilestone};
use wf_core::plan::milestone::MilestoneDependency;

use super::to_js;

/// [`chip_target`](chip::chip_target): where a dependency chip goes when tapped.
///
/// # Errors
///
/// Fails if `dep` or `milestones` has the wrong shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = planChipTarget)]
pub fn plan_chip_target_js(
    dep: JsValue,
    known: JsValue,
    milestones: JsValue,
    is_offline_build: bool,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let dep: MilestoneDependency = serde_wasm_bindgen::from_value(dep)?;
    let known: Vec<String> = serde_wasm_bindgen::from_value(known)?;
    let milestones: Vec<ChipMilestone> = serde_wasm_bindgen::from_value(milestones)?;
    to_js(&chip::chip_target(
        &dep,
        &known,
        &milestones,
        is_offline_build,
    ))
}

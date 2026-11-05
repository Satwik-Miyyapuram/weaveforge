//! Related-document helpers for JavaScript (wf-core `search::related`). The JS names match
//! `packages/core/src/search/related.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::related::{self, RelatedArm};

/// [`explain_arm`](related::explain_arm).
///
/// # Errors
///
/// Fails if `arm` is not a known arm name.
#[wasm_bindgen(js_name = explainArm)]
pub fn explain_arm_js(arm: JsValue) -> Result<String, serde_wasm_bindgen::Error> {
    let arm: RelatedArm = serde_wasm_bindgen::from_value(arm)?;
    Ok(related::explain_arm(arm).to_owned())
}

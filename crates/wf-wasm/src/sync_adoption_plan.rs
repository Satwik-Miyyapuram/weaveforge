//! Adoption rename plan for JavaScript (wf-core `sync::adoption_plan`). The JS name
//! matches `packages/wf-wasm/src/wrappers-10.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::adoption_plan::{LocalProject, plan_renames};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`plan_renames`]: the renames adoption needs. `local` is the projects in name order.
///
/// # Errors
///
/// Fails if `local` is not an array of `{ id, name }`, `remote_names` is not an array of strings,
/// or the result cannot be serialised.
#[wasm_bindgen(js_name = planRenames, unchecked_return_type = "B.Rename[]")]
pub fn plan_renames_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.LocalProject[]")] local: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] remote_names: JsValue,
    device_label: &str,
) -> JsResult<JsValue> {
    let local: Vec<LocalProject> = serde_wasm_bindgen::from_value(local)?;
    let remote_names: Vec<String> = serde_wasm_bindgen::from_value(remote_names)?;
    to_js(&plan_renames(&local, &remote_names, device_label))
}

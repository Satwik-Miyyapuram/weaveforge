//! Claimed hand-written file plan for JavaScript (wf-core `workspace::claim_import`).

use indexmap::IndexMap;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::claim_import;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`plan_claim`](claim_import::plan_claim): `{ stamped, digests }`, or `null` when the file
/// already carries an id and nothing should be written.
///
/// # Errors
///
/// Fails when `base` is not an object of string digests.
#[wasm_bindgen(
    js_name = planClaimImport,
    unchecked_return_type = "{ stamped: string; digests: Record<string, string> } | null"
)]
pub fn plan_claim_import_js(
    content: &str,
    id: &str,
    path: &str,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] base: JsValue,
) -> JsResult<JsValue> {
    let base: IndexMap<String, String> = serde_wasm_bindgen::from_value(base)?;
    match claim_import::plan_claim(content, id, path, &base) {
        Some(plan) => serde_wasm_bindgen::to_value(&plan),
        None => Ok(JsValue::NULL),
    }
}

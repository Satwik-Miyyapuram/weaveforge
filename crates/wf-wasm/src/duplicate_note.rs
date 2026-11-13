//! The plan for a duplicate note (wf-core `editor_workspace::duplicate_note`),
//! served as is from `@weaveforge/wasm`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::editor_workspace::duplicate_note::{self as duplicate, DuplicateSource};

use super::to_js;

/// [`duplicate_plan`](duplicate::duplicate_plan) as `{ title, parentId, body }`, or `null`.
///
/// # Errors
///
/// Fails if `doc` or `documents` does not have the shape of a duplicate source.
#[wasm_bindgen(js_name = duplicatePlan, unchecked_return_type = "B.DuplicatePlan | null")]
pub fn duplicate_plan_js(
    #[wasm_bindgen(unchecked_param_type = "B.DuplicateSource | null | undefined")] doc: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.DuplicateSource[]")] documents: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let doc: Option<DuplicateSource> = serde_wasm_bindgen::from_value(doc)?;
    let documents: Vec<DuplicateSource> = serde_wasm_bindgen::from_value(documents)?;
    to_js(&duplicate::duplicate_plan(doc.as_ref(), &documents))
}

//! Overleaf root folder id from the join answer (wf-core `overleaf::upload`).

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::overleaf::upload;

/// [`root_folder_id_of`](upload::root_folder_id_of): the writable project's root folder id, or
/// `null` when read-only or the answer has none.
///
/// # Errors
///
/// Fails if `join` is not an array of JSON values.
#[wasm_bindgen(js_name = rootFolderIdOf, unchecked_return_type = "string | null")]
pub fn root_folder_id_of(
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] join: JsValue,
) -> Result<JsValue, JsValue> {
    let join: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(join)?;
    Ok(upload::root_folder_id_of(&join).map_or(JsValue::NULL, |id| JsValue::from_str(&id)))
}

//! Overleaf root folder id from the join answer (wf-core `overleaf::upload`). The TS wrapper
//! `packages/wf-wasm/src/overleaf-upload.ts` maps the absent id to `null`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::overleaf::upload;

/// [`root_folder_id_of`](upload::root_folder_id_of): the writable project's root folder id, or
/// `undefined` when read-only or the answer has none.
#[wasm_bindgen(js_name = rootFolderIdOf)]
pub fn root_folder_id_of(join: JsValue) -> Result<Option<String>, JsValue> {
    let join: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(join)?;
    Ok(upload::root_folder_id_of(&join))
}

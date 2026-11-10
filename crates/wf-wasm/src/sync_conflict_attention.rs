//! Open-conflict attention rules for JavaScript (wf-core `sync::conflict_attention`).
//! The JS names match `packages/wf-wasm/src/sync-conflict-attention.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::conflict_attention::{OpenConflict, count_open, keep_all_picks, needs_person};
use wf_core::sync::conflict_deletion::PickSide;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`needs_person`]: whether one open conflict still needs a person.
#[wasm_bindgen(js_name = needsPerson)]
pub fn needs_person_js(kind: &str, field_count: usize) -> bool {
    needs_person(kind, field_count)
}

/// [`count_open`]: how many open conflicts still need a person.
///
/// # Errors
///
/// Fails if `open` is not an array of `{ kind, fieldCount }` objects.
#[wasm_bindgen(js_name = countOpen)]
pub fn count_open_js(open: JsValue) -> Result<usize, serde_wasm_bindgen::Error> {
    let open: Vec<OpenConflict> = serde_wasm_bindgen::from_value(open)?;
    Ok(count_open(&open))
}

/// [`keep_all_picks`]: the field picks a "keep all" makes on one side.
///
/// # Errors
///
/// Fails if `fields` is not an array of strings, or `side` is not `"local"` or `"remote"`.
#[wasm_bindgen(js_name = keepAllPicks, unchecked_return_type = "{ field: string; side: \"local\" | \"remote\" }[]")]
pub fn keep_all_picks_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] fields: JsValue,
    #[wasm_bindgen(unchecked_param_type = "\"local\" | \"remote\"")] side: JsValue,
) -> JsResult<JsValue> {
    let fields: Vec<String> = serde_wasm_bindgen::from_value(fields)?;
    let side: PickSide = serde_wasm_bindgen::from_value(side)?;
    to_js(&keep_all_picks(&fields, side))
}

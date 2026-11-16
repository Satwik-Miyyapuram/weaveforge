//! JSON-row apply plan for JavaScript (wf-core `workspace::json_apply`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::json_apply::{self, JsonEntry};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`plan_json_apply`](json_apply::plan_json_apply): the ordered `{ index, target, remove, id }`
/// steps and the distinct `files` for a folder's JSON entries.
///
/// # Errors
///
/// Fails if `entries` does not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = planJsonApply, unchecked_return_type = "{ steps: { index: number; target: 'relations' | 'tags' | 'reading_list_items'; remove: boolean; id: string }[]; files: string[] }")]
pub fn plan_json_apply_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { action: 'created' | 'updated' | 'unchanged' | 'conflict' | 'removed'; kind: string; path: string; existingId: string }[]"
    )]
    entries: JsValue,
) -> JsResult<JsValue> {
    let entries: Vec<JsonEntry> = serde_wasm_bindgen::from_value(entries)?;
    to_js(&json_apply::plan_json_apply(&entries))
}

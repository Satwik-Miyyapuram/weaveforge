//! Resource-type to search-kind policy for JavaScript (wf-core `search_index_state`).
//! The JS names match `packages/wf-wasm/src/search-index-state.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::search_index_state;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`kinds_for_resource`](search_index_state::kinds_for_resource): the kinds a write can change, or `null` when unmapped.
///
/// # Errors
///
/// Fails only if the result cannot be serialized.
#[wasm_bindgen(js_name = kindsForResource)]
pub fn kinds_for_resource_js(resource_type: &str) -> JsResult<wasm_bindgen::JsValue> {
    to_js(&search_index_state::kinds_for_resource(resource_type))
}

/// Every mapped resource type, in table order.
///
/// # Errors
///
/// Fails only if the result cannot be serialized.
#[wasm_bindgen(js_name = resourceTypes)]
pub fn resource_types_js() -> JsResult<wasm_bindgen::JsValue> {
    to_js(&search_index_state::resource_types())
}

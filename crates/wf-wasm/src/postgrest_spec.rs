//! PostgREST table specs for JavaScript (wf-core `postgrest_spec`). The TS wrapper in
//! `packages/wf-wasm/src/postgrest-spec.ts` applies the types.

use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::postgrest_spec::{keyed_column_spec, row_spec};

use super::to_js;

/// [`row_spec`]: the row spec named `name`, or `null` when there is none.
#[wasm_bindgen(js_name = postgrestRowSpec)]
pub fn postgrest_row_spec_js(name: &str) -> Result<wasm_bindgen::JsValue, JsError> {
    to_js(&row_spec(name)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`keyed_column_spec`]: the keyed-column spec named `name`, or `null` when there is none.
#[wasm_bindgen(js_name = postgrestKeyedColumnSpec)]
pub fn postgrest_keyed_column_spec_js(name: &str) -> Result<wasm_bindgen::JsValue, JsError> {
    to_js(&keyed_column_spec(name)).map_err(|error| JsError::new(&error.to_string()))
}

//! PostgREST wire rules for the sync transport, for JavaScript (wf-core `sync::postgrest_wire`).
//! The JS names are `postgrestWritable` and `postgrestErrorInfo`, called from
//! `apps/web/src/features/offline-sync/infra/postgrest-transport.ts`.

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::postgrest_wire::{error_info, writable};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`writable`] for JS (TS `postgrestWritable`): the payload minus the table's generated columns.
///
/// # Errors
///
/// Fails when `payload` is not an object.
#[wasm_bindgen(js_name = postgrestWritable)]
pub fn writable_js(table: &str, payload: JsValue) -> JsResult<JsValue> {
    let payload: Option<Map<String, Value>> = serde_wasm_bindgen::from_value(payload)?;
    to_js(&writable(table, payload))
}

/// [`error_info`] for JS (TS `postgrestErrorInfo`): `{ code, firstLine }` of an error body.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = postgrestErrorInfo)]
pub fn error_info_js(body: &str) -> JsResult<JsValue> {
    to_js(&error_info(body))
}

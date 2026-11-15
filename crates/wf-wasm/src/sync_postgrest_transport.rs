//! Sync transport request builders for JavaScript (wf-core
//! `sync::postgrest_transport`). The JS names are called from
//! `apps/web/src/features/offline-sync/infra/postgrest-transport.ts`. `fetch` stays in TS.
//! Reply decisions are in `sync_send_steps`.

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::postgrest_transport::{
    RequestSpec, changes_request, presence_request, request_init, write_request,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`write_request`] for JS: the method, path, body and `prefer` of one queued write.
///
/// # Errors
///
/// Fails when the payload is not an object or the result cannot be serialised.
#[wasm_bindgen(
    js_name = postgrestWriteRequest,
    unchecked_return_type = "{ method: string; path: string; body?: string; prefer?: string }"
)]
pub fn write_request_js(
    op: String,
    table: String,
    row_id: String,
    base_version: Option<f64>,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown> | undefined")] payload: JsValue,
) -> JsResult<JsValue> {
    let payload: Option<Map<String, Value>> = serde_wasm_bindgen::from_value(payload)?;
    to_js(&write_request(&op, &table, &row_id, base_version, payload))
}

/// [`presence_request`] for JS: the read that asks which of these ids the server holds.
///
/// # Errors
///
/// Fails when `ids` is not an array of strings or the result cannot be serialised.
#[wasm_bindgen(js_name = postgrestPresenceRequest, unchecked_return_type = "{ method: string; path: string; body?: string; prefer?: string }")]
pub fn presence_request_js(
    table: String,
    #[wasm_bindgen(unchecked_param_type = "string[]")] ids: JsValue,
) -> JsResult<JsValue> {
    let ids: Vec<String> = serde_wasm_bindgen::from_value(ids)?;
    to_js(&presence_request(&table, &ids))
}

/// [`changes_request`] for JS: the `sync_changes` RPC read from `since`, `limit` rows at most.
///
/// # Errors
///
/// Fails when the result cannot be serialised.
#[wasm_bindgen(js_name = postgrestChangesRequest, unchecked_return_type = "{ method: string; path: string; body?: string; prefer?: string }")]
#[allow(clippy::cast_possible_truncation)]
pub fn changes_request_js(since: f64, limit: f64) -> JsResult<JsValue> {
    to_js(&changes_request(since as i64, limit as i64))
}

/// [`request_init`] for JS: the headers and body to hand `fetch`, from a request built above.
///
/// # Errors
///
/// Fails when `spec` is not a request or the result cannot be serialised.
#[wasm_bindgen(js_name = postgrestRequestInit, unchecked_return_type = "{ method: string; path: string; headers: Record<string, string>; body?: string }")]
pub fn request_init_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ method: string; path: string; body?: string; prefer?: string }"
    )]
    spec: JsValue,
    api_key: String,
    token: Option<String>,
) -> JsResult<JsValue> {
    let spec: RequestSpec = serde_wasm_bindgen::from_value(spec)?;
    to_js(&request_init(&spec, &api_key, token.as_deref()))
}

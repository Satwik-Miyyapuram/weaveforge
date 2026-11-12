//! Send and pull step decisions for JavaScript (wf-core `sync::send_steps`).
//! The JS names are called from
//! `apps/web/src/features/offline-sync/infra/postgrest-transport.ts`. `fetch` stays in TS.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::send_steps::{
    ReadState, changes_from_reply, missing_after_presence, missing_after_tombstones,
    missing_id_chunks, send_advance, send_start,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`send_start`] for JS: the outcome of one write, or the first read it needs.
///
/// # Errors
///
/// Fails when the result cannot be serialised.
#[wasm_bindgen(
    js_name = sendStart,
    unchecked_return_type = "{ next: \"done\"; outcome: unknown } | { next: \"read\"; request: { method: string; path: string; body?: string; prefer?: string }; state: unknown }"
)]
pub fn send_start_js(status: u16, body: String, op: String, table: String, row_id: String) -> JsResult<JsValue> {
    to_js(&send_start(status, &body, &op, &table, &row_id))
}

/// [`send_advance`] for JS: the next step after a read answered, from the `state` that `sendStart` gave.
///
/// # Errors
///
/// Fails when `state` is not a read state or the result cannot be serialised.
#[wasm_bindgen(
    js_name = sendAdvance,
    unchecked_return_type = "{ next: \"done\"; outcome: unknown } | { next: \"read\"; request: { method: string; path: string; body?: string; prefer?: string }; state: unknown }"
)]
pub fn send_advance_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] state: JsValue,
    status: u16,
    body: String,
) -> JsResult<JsValue> {
    let state: ReadState = serde_wasm_bindgen::from_value(state)?;
    to_js(&send_advance(&state, status, &body))
}

/// [`missing_id_chunks`] for JS: the ids split into the chunks `missingIds` reads, in order.
///
/// # Errors
///
/// Fails when `ids` is not an array of strings or the result cannot be serialised.
#[wasm_bindgen(js_name = missingIdChunks, unchecked_return_type = "string[][]")]
pub fn missing_id_chunks_js(#[wasm_bindgen(unchecked_param_type = "string[]")] ids: JsValue) -> JsResult<JsValue> {
    let ids: Vec<String> = serde_wasm_bindgen::from_value(ids)?;
    to_js(&missing_id_chunks(&ids))
}

/// [`missing_after_presence`] for JS: done for a chunk, failed, or the tombstone read it needs.
///
/// # Errors
///
/// Fails when `chunk` is not an array of strings or the result cannot be serialised.
#[wasm_bindgen(
    js_name = missingAfterPresence,
    unchecked_return_type = "{ next: \"failed\" } | { next: \"done\"; missing: string[] } | { next: \"tombstones\"; request: { method: string; path: string; body?: string; prefer?: string }; held: string[] }"
)]
pub fn missing_after_presence_js(
    table: String,
    #[wasm_bindgen(unchecked_param_type = "string[]")] chunk: JsValue,
    status: u16,
    body: String,
) -> JsResult<JsValue> {
    let chunk: Vec<String> = serde_wasm_bindgen::from_value(chunk)?;
    to_js(&missing_after_presence(&table, &chunk, status, &body))
}

/// [`missing_after_tombstones`] for JS: the missing ids of a chunk, or `null` when the read is unusable.
///
/// # Errors
///
/// Fails when `chunk` or `held` is not an array of strings or the result cannot be serialised.
#[wasm_bindgen(js_name = missingAfterTombstones, unchecked_return_type = "string[] | null")]
pub fn missing_after_tombstones_js(
    #[wasm_bindgen(unchecked_param_type = "string[]")] chunk: JsValue,
    #[wasm_bindgen(unchecked_param_type = "string[]")] held: JsValue,
    status: u16,
    body: String,
) -> JsResult<JsValue> {
    let chunk: Vec<String> = serde_wasm_bindgen::from_value(chunk)?;
    let held: Vec<String> = serde_wasm_bindgen::from_value(held)?;
    to_js(&missing_after_tombstones(&chunk, &held, status, &body))
}

/// [`changes_from_reply`] for JS: the pulled changes, or the error text when the read failed.
///
/// # Errors
///
/// Fails when the result cannot be serialised.
#[wasm_bindgen(js_name = changesFromReply, unchecked_return_type = "{ error: string | null; changes: unknown[] }")]
pub fn changes_from_reply_js(status: u16, body: String) -> JsResult<JsValue> {
    to_js(&changes_from_reply(status, &body))
}

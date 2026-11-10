//! Conflict routing for the outbox pump, for JavaScript (wf-core `sync::conflict_route`).
//! The JS name is `conflictRoute`, called from `apps/web/src/features/offline-sync/domain/pump.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::conflict_route::{ConflictInput, conflict_route};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`conflict_route`] for JS (TS `conflictRoute`).
///
/// # Errors
///
/// Fails when `input` is not a conflict input.
#[wasm_bindgen(js_name = conflictRoute)]
pub fn conflict_route_js(input: JsValue) -> JsResult<JsValue> {
    let input: ConflictInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&conflict_route(&input))
}

//! Owed-op sides for a conflict, for JavaScript (wf-core `sync::outbox_sides`). The JS names
//! match `editSides`, `deletedRemoteSides` and `deletedLocalBase` in
//! `packages/wf-wasm/src/sync-outbox-sides.ts`.

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::outbox_sides::{OwedOp, deleted_local_base, deleted_remote_sides, edit_sides};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`edit_sides`] for JS (TS `editSides`). `null` when no non-delete op is owed.
///
/// # Errors
///
/// Fails when `ops` is not a list of outbox ops.
#[wasm_bindgen(js_name = editSides)]
pub fn edit_sides_js(ops: JsValue) -> JsResult<JsValue> {
    let ops: Vec<OwedOp> = serde_wasm_bindgen::from_value(ops)?;
    to_js(&edit_sides(&ops))
}

/// [`deleted_remote_sides`] for JS (TS `deletedRemoteSides`). `stored` is the local row or
/// `null`; `null` is returned when neither it nor an owed op is available.
///
/// # Errors
///
/// Fails when `ops` is not a list of outbox ops or `stored` is not a plain object.
#[wasm_bindgen(js_name = deletedRemoteSides)]
pub fn deleted_remote_sides_js(ops: JsValue, stored: JsValue) -> JsResult<JsValue> {
    let ops: Vec<OwedOp> = serde_wasm_bindgen::from_value(ops)?;
    let stored: Option<Map<String, Value>> = serde_wasm_bindgen::from_value(stored)?;
    to_js(&deleted_remote_sides(&ops, stored))
}

/// [`deleted_local_base`] for JS (TS `deletedLocalBase`). Empty when there are no ops.
///
/// # Errors
///
/// Fails when `ops` is not a list of outbox ops.
#[wasm_bindgen(js_name = deletedLocalBase)]
pub fn deleted_local_base_js(ops: JsValue) -> JsResult<JsValue> {
    let ops: Vec<OwedOp> = serde_wasm_bindgen::from_value(ops)?;
    to_js(&deleted_local_base(&ops))
}

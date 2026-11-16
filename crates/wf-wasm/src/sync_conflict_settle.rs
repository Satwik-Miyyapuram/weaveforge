//! Settling an open conflict, for JavaScript (wf-core `sync::conflict_settle`). The JS names
//! match `settleConflictPlan` and `sameRow` in `packages/wf-wasm/src/sync-conflict-settle.ts`.

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::conflict_settle::{OpenConflictKind, same_row, settle_plan};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`settle_plan`] for JS (TS `settleConflictPlan`). `kind` is `"edit"`, `"deleted_remote"` or
/// `"deleted_local"`. Returns `{ action, ... }`.
///
/// # Errors
///
/// Fails when `kind` is not one of those strings or a row is not a plain object.
#[wasm_bindgen(js_name = settleConflictPlan, unchecked_return_type = "B.ConflictSettlePlan")]
pub fn settle_conflict_plan_js(
    #[wasm_bindgen(unchecked_param_type = "\"edit\" | \"deleted_remote\" | \"deleted_local\"")]
    kind: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] base: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] local: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] remote: JsValue,
) -> JsResult<JsValue> {
    let kind: OpenConflictKind = serde_wasm_bindgen::from_value(kind)?;
    let base: Map<String, Value> = serde_wasm_bindgen::from_value(base)?;
    let local: Map<String, Value> = serde_wasm_bindgen::from_value(local)?;
    let remote: Map<String, Value> = serde_wasm_bindgen::from_value(remote)?;
    to_js(&settle_plan(kind, &base, &local, &remote))
}

/// [`same_row`] for JS (TS `sameRow`).
///
/// # Errors
///
/// Fails when a row is not a plain object.
#[wasm_bindgen(js_name = sameRow)]
pub fn same_row_js(
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] a: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] b: JsValue,
) -> JsResult<bool> {
    let a: Map<String, Value> = serde_wasm_bindgen::from_value(a)?;
    let b: Map<String, Value> = serde_wasm_bindgen::from_value(b)?;
    Ok(same_row(&a, &b))
}

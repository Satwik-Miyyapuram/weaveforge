//! Settling a conflict the reader chose on, for JavaScript (wf-core `sync::conflict_resolve`).
//! The JS names match `resolveWithRow` and `deletionAction` in
//! `packages/wf-wasm/src/wrappers-10.ts`.

use std::collections::HashMap;

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::conflict_deletion::{DeleteConflictKind, DeletionChoice};
use wf_core::sync::conflict_resolve::{FieldSide, deletion_action, resolve_with_row};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`resolve_with_row`] for JS (TS `resolveWithRow`). `picks` maps a field to `"local"` or
/// `"remote"`; `overrides` is a row, or absent (`null`/`undefined`) for none.
///
/// # Errors
///
/// Fails when a row or `picks` is not a plain object, or a pick is not `"local"`/`"remote"`.
#[wasm_bindgen(js_name = resolveWithRow, unchecked_return_type = "Record<string, unknown>")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn resolve_with_row_js(
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] base: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] local: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] remote: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, \"local\" | \"remote\">")] picks: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "Record<string, unknown> | null")]
    overrides: Option<JsValue>,
) -> JsResult<JsValue> {
    let base: Map<String, Value> = serde_wasm_bindgen::from_value(base)?;
    let local: Map<String, Value> = serde_wasm_bindgen::from_value(local)?;
    let remote: Map<String, Value> = serde_wasm_bindgen::from_value(remote)?;
    let picks: HashMap<String, FieldSide> = serde_wasm_bindgen::from_value(picks)?;
    let overrides: Option<Map<String, Value>> =
        serde_wasm_bindgen::from_value(overrides.unwrap_or(JsValue::NULL))?;
    to_js(&resolve_with_row(
        &base,
        &local,
        &remote,
        &picks,
        overrides.as_ref(),
    ))
}

/// [`deletion_action`] for JS (TS `deletionAction`). `kind` is `"deleted_remote"` or
/// `"deleted_local"`, `choice` is `"keep"` or `"delete"`, and `remote` is the server row or `null`.
///
/// # Errors
///
/// Fails when `kind` or `choice` is not one of its strings, or a row is not a plain object.
#[wasm_bindgen(js_name = deletionAction, unchecked_return_type = "B.ConflictDeletionAction")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn deletion_action_js(
    #[wasm_bindgen(unchecked_param_type = "\"deleted_remote\" | \"deleted_local\"")] kind: JsValue,
    #[wasm_bindgen(unchecked_param_type = "\"keep\" | \"delete\"")] choice: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] local: JsValue,
    row_id: String,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown> | null")] remote: JsValue,
) -> JsResult<JsValue> {
    let kind: DeleteConflictKind = serde_wasm_bindgen::from_value(kind)?;
    let choice: DeletionChoice = serde_wasm_bindgen::from_value(choice)?;
    let local: Map<String, Value> = serde_wasm_bindgen::from_value(local)?;
    let remote: Option<Map<String, Value>> = serde_wasm_bindgen::from_value(remote)?;
    to_js(&deletion_action(
        kind,
        choice,
        &local,
        &row_id,
        remote.as_ref(),
    ))
}

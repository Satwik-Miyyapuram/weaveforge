//! The integration branch rules for JavaScript (wf-core `sync::integration_store`). The JS
//! names `branchRead` and `branchSave` are wrapped by
//! `packages/wf-wasm/src/sync-integration-store.ts`, which
//! `features/sync/infrastructure/postgrest-integrations-store.ts` calls.

use serde_wasm_bindgen::Error;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::integration_store::{
    BranchReadInput, BranchSaveInput, branch_read, branch_save,
};

use super::to_js;

type JsResult<T> = Result<T, Error>;

/// [`branch_read`] for JS (TS `branchRead`).
///
/// # Errors
///
/// Fails when `input` is not a branch read input with the expected fields.
#[wasm_bindgen(js_name = branchRead)]
pub fn branch_read_js(input: JsValue) -> JsResult<JsValue> {
    let input: BranchReadInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&branch_read(&input))
}

/// [`branch_save`] for JS (TS `branchSave`).
///
/// # Errors
///
/// Fails when `input` is not a branch save input with the expected fields.
#[wasm_bindgen(js_name = branchSave)]
pub fn branch_save_js(input: JsValue) -> JsResult<JsValue> {
    let input: BranchSaveInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&branch_save(&input))
}

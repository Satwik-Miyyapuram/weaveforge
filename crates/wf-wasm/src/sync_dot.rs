//! The sync dot for JavaScript (wf-core `sync::sync_dot`). The JS name `syncDot` is wrapped
//! by `packages/wf-wasm/src/wrappers-10.ts`, which `domain/sync-status.ts` calls.

use serde_wasm_bindgen::Error;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::sync_dot::{SyncDotInput, sync_dot};

use super::to_js;

type JsResult<T> = Result<T, Error>;

/// [`sync_dot`] for JS (TS `syncDot`). `null` when the account does not sync and is online.
///
/// # Errors
///
/// Fails when `input` is not a sync state with the expected fields.
#[wasm_bindgen(js_name = syncDot, unchecked_return_type = "B.SyncDot | null")]
pub fn sync_dot_js(
    #[wasm_bindgen(unchecked_param_type = "B.SyncDotInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: SyncDotInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&sync_dot(&input))
}

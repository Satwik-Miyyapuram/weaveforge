//! Sync-state row mapping and the adoption gate for JavaScript (wf-core `sync::sync_state`).
//! The JS names are `syncStateFromRow` and `adoptedAccount`, called from
//! `apps/web/src/features/offline-sync/domain/parts-1.ts` and `parts-3.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::sync_state::{SyncStateRow, adopted_account, sync_state};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`sync_state`] for JS (TS `SyncStateStore.read`). A null row reads as nothing read.
///
/// # Errors
///
/// Fails when `row` is neither null nor a `sync_state` row, or the result cannot be serialised.
#[wasm_bindgen(js_name = syncStateFromRow, unchecked_return_type = "unknown")]
pub fn sync_state_js(#[wasm_bindgen(unchecked_param_type = "unknown")] row: JsValue) -> JsResult<JsValue> {
    let row: Option<SyncStateRow> = serde_wasm_bindgen::from_value(row)?;
    to_js(&sync_state(row.as_ref()))
}

/// [`adopted_account`] for JS (TS `Adoption.run` gate): the account that refuses a second
/// adoption, or undefined when the device may adopt.
#[wasm_bindgen(js_name = adoptedAccount)]
#[must_use]
pub fn adopted_account_js(account_id: Option<String>) -> Option<String> {
    adopted_account(account_id.as_deref())
}

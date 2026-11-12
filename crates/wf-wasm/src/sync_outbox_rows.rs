//! Outbox row mapping for JavaScript (wf-core `sync::outbox_rows`). The JS name is
//! `outboxEntries`, called from `apps/web/src/features/offline-sync/domain/parts-2.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::outbox_rows::{OutboxRow, outbox_entries};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`outbox_entries`] for JS (TS `toEntry`, applied to each row of a result set).
///
/// # Errors
///
/// Fails when `rows` is not an array of outbox rows, or the result cannot be serialised.
#[wasm_bindgen(js_name = outboxEntries, unchecked_return_type = "unknown[]")]
pub fn outbox_entries_js(
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] rows: JsValue,
) -> JsResult<JsValue> {
    let rows: Vec<OutboxRow> = serde_wasm_bindgen::from_value(rows)?;
    to_js(&outbox_entries(&rows))
}

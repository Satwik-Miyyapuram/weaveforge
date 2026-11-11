//! Send verdict and missing-id rules for JavaScript (wf-core `sync::send_verdict`).
//! The JS names match `packages/wf-wasm/src/wrappers-11.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::send_verdict::{classify_send, is_link_insert, missing_ids};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`classify_send`]: the verdict for one write. `error_code` is the Postgres code from the body, or null.
/// `rows` is how many rows a guarded write returned, or null when the body was not an array.
///
/// # Errors
///
/// Fails if the result cannot be serialised.
#[wasm_bindgen(js_name = classifySend)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn classify_send_js(
    status: u16,
    error_code: Option<String>,
    rows: Option<u32>,
) -> JsResult<JsValue> {
    let rows = rows.map(|n| n as usize);
    to_js(&classify_send(status, error_code.as_deref(), rows))
}

/// [`is_link_insert`]: whether a write is a paper_tags insert, where a duplicate means the link already exists.
#[wasm_bindgen(js_name = isLinkInsert)]
pub fn is_link_insert_js(op: &str, table: &str) -> bool {
    is_link_insert(op, table)
}

/// [`missing_ids`]: the ids in `chunk` the server did not return and has no tombstone for.
///
/// # Errors
///
/// Fails if any argument is not an array of strings.
#[wasm_bindgen(js_name = missingIds, unchecked_return_type = "string[]")]
pub fn missing_ids_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] chunk: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] held: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] tombstoned: JsValue,
) -> JsResult<JsValue> {
    let chunk: Vec<String> = serde_wasm_bindgen::from_value(chunk)?;
    let held: Vec<String> = serde_wasm_bindgen::from_value(held)?;
    let tombstoned: Vec<String> = serde_wasm_bindgen::from_value(tombstoned)?;
    to_js(&missing_ids(&chunk, &held, &tombstoned))
}

//! Kind-to-status map for the TS error taxonomy (wf-core `error_status`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::error_status;

/// [`http_status_for_kind`](error_status::http_status_for_kind): the HTTP status for an error kind.
#[wasm_bindgen(js_name = httpStatusForKind)]
#[must_use]
pub fn http_status_for_kind_js(kind: &str) -> u16 {
    error_status::http_status_for_kind(kind)
}

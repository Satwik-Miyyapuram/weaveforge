//! The upload error suffix (wf-core `overleaf::upload_reason`). The TS wrapper
//! `packages/wf-wasm/src/overleaf-upload-reason.ts` gives it its type.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::overleaf::upload_reason;

/// [`error_suffix`](upload_reason::error_suffix): `": <message>"` from an upload answer body, or `""`.
#[wasm_bindgen(js_name = uploadErrorSuffix)]
pub fn upload_error_suffix(body: &str) -> String {
    upload_reason::error_suffix(body)
}

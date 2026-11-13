//! PDF response rules for JavaScript (`apps/web/src/features/reader/application/pdf-response-rules.ts`).
//! Wraps `wf_core::reader::pdf_response`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::pdf_response::{
    has_pdf_magic, host_of, is_pdf_content_type, media_type_essence, read_failure_reason,
};

/// [`media_type_essence`]: the media type without parameters, lowercased.
#[wasm_bindgen(js_name = mediaTypeEssence)]
pub fn media_type_essence_js(value: &str) -> String {
    media_type_essence(value)
}

/// [`is_pdf_content_type`]: whether a `Content-Type` value names a PDF. `null` or empty is not.
#[wasm_bindgen(js_name = isPdfContentType)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn is_pdf_content_type_js(value: Option<String>) -> bool {
    is_pdf_content_type(value.as_deref())
}

/// [`has_pdf_magic`]: whether the first bytes carry the `%PDF-` signature.
#[wasm_bindgen(js_name = hasPdfMagic)]
pub fn has_pdf_magic_js(bytes: &[u8]) -> bool {
    has_pdf_magic(bytes)
}

/// [`host_of`]: the host and port of a PDF address for a failure line, or the address when it has none.
#[wasm_bindgen(js_name = hostOf)]
pub fn host_of_js(url: &str) -> String {
    host_of(url)
}

/// [`read_failure_reason`]: why a read failed. `status` is the HTTP status when there was a response.
#[wasm_bindgen(js_name = readFailureReason)]
pub fn read_failure_reason_js(message: &str, status: Option<u16>) -> String {
    read_failure_reason(message, status)
}

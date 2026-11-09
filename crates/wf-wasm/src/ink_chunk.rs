//! The ink chunk container for JavaScript (wf-core `ink::chunk`). The JS names
//! match `packages/core/src/ink/ink-binary.ts`, which keeps the typed-array
//! views and the async compression around these.

use wasm_bindgen::prelude::{JsError, JsValue, wasm_bindgen};
use wf_core::ink::ink_page::InkPage;
use wf_core::ink::{chunk, chunk_read};

use super::to_js;

fn page_from(page: JsValue) -> Result<InkPage, JsError> {
    serde_wasm_bindgen::from_value(page).map_err(|error| JsError::new(&error.to_string()))
}

fn js(value: &impl serde::Serialize) -> Result<JsValue, JsError> {
    to_js(value).map_err(|error| JsError::new(&error.to_string()))
}

/// [`encode_ink_chunk_body`](chunk::encode_ink_chunk_body): a page packed into an uncompressed body.
///
/// # Errors
///
/// Fails on a page the format cannot hold, or one that is not an `InkPage`.
#[wasm_bindgen(js_name = encodeInkChunkBody)]
pub fn encode_ink_chunk_body_js(page: JsValue) -> Result<Vec<u8>, JsError> {
    chunk::encode_ink_chunk_body(&page_from(page)?).map_err(|error| JsError::new(&error))
}

/// [`ink_chunk_body_size`](chunk::ink_chunk_body_size): the body length a page would take.
///
/// # Errors
///
/// Fails on a body over `u32`, or a value that is not an `InkPage`.
#[wasm_bindgen(js_name = inkChunkBodySize)]
pub fn ink_chunk_body_size_js(page: JsValue) -> Result<u32, JsError> {
    chunk::ink_chunk_body_size(&page_from(page)?).map_err(|error| JsError::new(&error))
}

/// [`read_ink_chunk_header`](chunk::read_ink_chunk_header): the 16-byte header.
///
/// # Errors
///
/// Fails on a header the format refuses.
#[wasm_bindgen(js_name = readInkChunkHeader)]
pub fn read_ink_chunk_header_js(bytes: &[u8]) -> Result<JsValue, JsError> {
    js(&chunk::read_ink_chunk_header(bytes).map_err(|error| JsError::new(&error))?)
}

/// [`ink_chunk_header_bytes`](chunk::ink_chunk_header_bytes): the header for a payload.
#[must_use]
#[wasm_bindgen(js_name = inkChunkHeaderBytes)]
pub fn ink_chunk_header_bytes_js(body_size: u32, payload_size: u32, compressed: bool) -> Vec<u8> {
    chunk::ink_chunk_header_bytes(body_size, payload_size, compressed)
}

/// [`check_ink_chunk_body`](chunk::check_ink_chunk_body): the layout and page header of a body
/// that passed every check.
///
/// # Errors
///
/// Fails on a body whose tables do not add up.
#[wasm_bindgen(js_name = checkInkChunkBody)]
pub fn check_ink_chunk_body_js(body: &[u8]) -> Result<JsValue, JsError> {
    js(&chunk::check_ink_chunk_body(body).map_err(|error| JsError::new(&error))?)
}

/// [`page_from_chunk_body`](chunk_read::page_from_chunk_body): a checked body as the page model.
///
/// # Errors
///
/// Fails on a body whose tables do not add up.
#[wasm_bindgen(js_name = pageFromChunkBody)]
pub fn page_from_chunk_body_js(body: &[u8]) -> Result<JsValue, JsError> {
    js(&chunk_read::page_from_chunk_body(body).map_err(|error| JsError::new(&error))?)
}

/// [`fits_ink_note_budget`](chunk::fits_ink_note_budget): whether these chunk sizes fit a note.
#[must_use]
#[wasm_bindgen(js_name = fitsInkNoteBudget)]
pub fn fits_ink_note_budget_js(sizes: &[f64]) -> bool {
    chunk::fits_ink_note_budget(sizes)
}

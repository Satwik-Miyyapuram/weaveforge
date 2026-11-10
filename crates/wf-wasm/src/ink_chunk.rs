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

/// [`stroke_point_triples`](chunk_read::stroke_point_triples): one stroke's `x, y, pressure` triples.
///
/// # Errors
///
/// Fails on a body whose tables do not add up.
#[wasm_bindgen(js_name = strokePointTriples)]
pub fn stroke_point_triples_js(body: &[u8], stroke_index: u32) -> Result<Vec<f64>, JsError> {
    chunk_read::stroke_point_triples(body, stroke_index as usize)
        .map_err(|error| JsError::new(&error))
}

/// [`absolute_point_triples`](chunk_read::absolute_point_triples): every point as `Int16` triples.
///
/// # Errors
///
/// Fails on a body whose tables do not add up.
#[wasm_bindgen(js_name = absolutePointTriples)]
pub fn absolute_point_triples_js(body: &[u8]) -> Result<Vec<i16>, JsError> {
    chunk_read::absolute_point_triples(body).map_err(|error| JsError::new(&error))
}

/// [`fits_ink_note_budget`](chunk::fits_ink_note_budget): whether these chunk sizes fit a note.
#[must_use]
#[wasm_bindgen(js_name = fitsInkNoteBudget)]
pub fn fits_ink_note_budget_js(sizes: &[f64]) -> bool {
    chunk::fits_ink_note_budget(sizes)
}

/// [`INK_CHUNK_RAW_THRESHOLD`](chunk::INK_CHUNK_RAW_THRESHOLD): the body size below which a chunk is stored raw.
#[must_use]
#[wasm_bindgen(js_name = inkChunkRawThreshold)]
pub fn ink_chunk_raw_threshold_js() -> f64 {
    chunk::INK_CHUNK_RAW_THRESHOLD as f64
}

/// [`should_try_compress`](chunk::should_try_compress): whether the codec runs on a body this size.
#[must_use]
#[wasm_bindgen(js_name = inkChunkShouldTryCompress)]
// JS passes a byte length, a whole non-negative number, so the cast is exact.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn ink_chunk_should_try_compress_js(body_len: f64) -> bool {
    chunk::should_try_compress(body_len as usize)
}

/// [`stores_compressed`](chunk::stores_compressed): whether the packed payload is stored.
#[must_use]
#[wasm_bindgen(js_name = inkChunkStoresCompressed)]
// JS passes byte lengths, whole non-negative numbers, so the casts are exact.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn ink_chunk_stores_compressed_js(body_len: f64, packed_len: f64) -> bool {
    chunk::stores_compressed(body_len as usize, packed_len as usize)
}

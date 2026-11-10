//! bytea hex and base64 codecs for JavaScript (wf-core `bytea`).

use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::bytea;

/// [`decode_bytea`](bytea::decode_bytea): bytes from a PostgREST `\x…` string.
#[wasm_bindgen(js_name = decodeBytea)]
#[must_use]
pub fn decode_bytea_js(text: &str) -> Vec<u8> {
    bytea::decode_bytea(text)
}

/// [`encode_bytea`](bytea::encode_bytea): PostgREST `\x…` string for bytes.
#[wasm_bindgen(js_name = encodeBytea)]
#[must_use]
pub fn encode_bytea_js(bytes: &[u8]) -> String {
    bytea::encode_bytea(bytes)
}

/// [`decode_base64`](bytea::decode_base64): bytes from base64 text, as `atob` reads it.
///
/// # Errors
/// Throws when the text is not base64.
#[wasm_bindgen(js_name = decodeBase64)]
pub fn decode_base64_js(text: &str) -> Result<Vec<u8>, JsError> {
    bytea::decode_base64(text).map_err(JsError::new)
}

/// [`encode_base64`](bytea::encode_base64): padded base64 for bytes.
#[wasm_bindgen(js_name = encodeBase64)]
#[must_use]
pub fn encode_base64_js(bytes: &[u8]) -> String {
    bytea::encode_base64(bytes)
}

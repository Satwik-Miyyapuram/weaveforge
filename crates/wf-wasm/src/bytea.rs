//! bytea hex and base64 codecs for JavaScript (wf-core `bytea`).

use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::{JsError, JsValue, wasm_bindgen};
use wf_core::bytea;

/// [`decode_bytea`](bytea::decode_bytea): bytes from a PostgREST `\x…` string. PGlite hands a
/// bytea column back as bytes already, so a `Uint8Array` passes through unchanged.
///
/// # Errors
///
/// Throws when `value` is neither a string nor a `Uint8Array`.
#[wasm_bindgen(js_name = decodeBytea, unchecked_return_type = "Uint8Array")]
pub fn decode_bytea_js(
    #[wasm_bindgen(unchecked_param_type = "string | Uint8Array")] value: JsValue,
) -> Result<JsValue, JsError> {
    if value.dyn_ref::<js_sys::Uint8Array>().is_some() {
        return Ok(value);
    }
    let text = value
        .as_string()
        .ok_or_else(|| JsError::new("decodeBytea: expected a string or Uint8Array"))?;
    Ok(js_sys::Uint8Array::from(bytea::decode_bytea(&text).as_slice()).into())
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
#[wasm_bindgen(js_name = decodeBase64, unchecked_return_type = "Uint8Array<ArrayBuffer>")]
pub fn decode_base64_js(text: &str) -> Result<Vec<u8>, JsError> {
    bytea::decode_base64(text).map_err(JsError::new)
}

/// [`encode_base64`](bytea::encode_base64): padded base64 for bytes.
#[wasm_bindgen(js_name = encodeBase64)]
#[must_use]
pub fn encode_base64_js(bytes: &[u8]) -> String {
    bytea::encode_base64(bytes)
}

//! Deep-link locus (de)serialisation for JavaScript (formerly `packages/core/src/reader/locus-link.ts`, now Rust).
//! Each export wraps a `wf_core::reader::locus` function; the locus crosses as a serde object.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::anchor::AnchorPdfLocus;
use wf_core::reader::locus::{decode_locus_value, encode_locus};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`encode_locus`] as raw JSON (encode at the URL layer, not here).
///
/// # Errors
///
/// Fails if `locus` is not a locus object.
#[wasm_bindgen(js_name = encodeLocus)]
pub fn encode_locus_js(
    #[wasm_bindgen(unchecked_param_type = "B.AnchorPdfLocus")] locus: JsValue,
) -> JsResult<String> {
    let locus: AnchorPdfLocus = serde_wasm_bindgen::from_value(locus)?;
    Ok(encode_locus(&locus))
}

/// [`decode_locus_value`] as a locus object, or `null` when malformed.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = decodeLocus)]
pub fn decode_locus_js(raw: Option<String>) -> JsResult<JsValue> {
    to_js(&decode_locus_value(raw.as_deref()))
}

//! Free-copy attempt selection (`apps/web/src/features/reader/application/parts-1.ts`).
//! Wraps `wf_core::reader::free_copy_attempts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::free_copy_attempts::{attempt_limits, pick_free_copy_attempts};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`pick_free_copy_attempts`]: `{ pdf: number[], html: number[] }`, the indexes of the listed
/// candidates to try in each format.
///
/// # Errors
///
/// Fails if `formats` is not an array of strings.
#[wasm_bindgen(
    js_name = pickFreeCopyAttempts,
    unchecked_return_type = "{ pdf: number[]; html: number[] }"
)]
pub fn pick_free_copy_attempts_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] formats: JsValue,
) -> JsResult<JsValue> {
    let formats: Vec<String> = serde_wasm_bindgen::from_value(formats)?;
    to_js(&pick_free_copy_attempts(&formats))
}

/// [`attempt_limits`]: `{ pdf, html }`, the caps on attempts per format.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = freeCopyAttemptLimits,
    unchecked_return_type = "{ pdf: number; html: number }"
)]
pub fn free_copy_attempt_limits_js() -> JsResult<JsValue> {
    to_js(&attempt_limits())
}

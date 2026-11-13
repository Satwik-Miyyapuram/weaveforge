//! Rendered-page eviction for the PDF reader
//! (`apps/web/src/features/reader/ui/pdf-reader/pdf-page-window.ts`).
//! Wraps `wf_core::reader::page_window`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::page_window::{PDF_KEEP_RADIUS, pages_to_evict};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`pages_to_evict`]: `rendered` and `visible` are number arrays; returns a sorted number array.
/// `radius` defaults to [`PDF_KEEP_RADIUS`].
///
/// # Errors
///
/// Fails if `rendered` or `visible` is not an array of numbers.
#[wasm_bindgen(js_name = pagesToEvict, unchecked_return_type = "number[]")]
pub fn pages_to_evict_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] rendered: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] visible: JsValue,
    radius: Option<f64>,
) -> JsResult<JsValue> {
    let rendered: Vec<f64> = serde_wasm_bindgen::from_value(rendered)?;
    let visible: Vec<f64> = serde_wasm_bindgen::from_value(visible)?;
    to_js(&pages_to_evict(
        &rendered,
        &visible,
        radius.unwrap_or(PDF_KEEP_RADIUS),
    ))
}

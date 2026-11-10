//! Rendered-page eviction for the PDF reader
//! (`apps/web/src/features/reader/ui/pdf-reader/pdf-page-window.ts`).
//! Wraps `wf_core::reader::page_window`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::page_window::pages_to_evict;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`pages_to_evict`]: `rendered` and `visible` are number arrays; returns a sorted number array.
///
/// # Errors
///
/// Fails if `rendered` or `visible` is not an array of numbers.
#[wasm_bindgen(js_name = pagesToEvict)]
pub fn pages_to_evict_js(rendered: JsValue, visible: JsValue, radius: f64) -> JsResult<JsValue> {
    let rendered: Vec<f64> = serde_wasm_bindgen::from_value(rendered)?;
    let visible: Vec<f64> = serde_wasm_bindgen::from_value(visible)?;
    to_js(&pages_to_evict(&rendered, &visible, radius))
}

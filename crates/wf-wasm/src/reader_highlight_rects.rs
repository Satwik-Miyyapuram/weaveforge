//! Highlight rect normalisation for JavaScript (`apps/web/src/features/reader/application/normalize-highlight-rects.ts`).
//! Wraps `wf_core::reader::highlight_rects`; rects cross as arrays of `[x1, y1, x2, y2]`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::highlight_rects::normalize_highlight_rects;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`normalize_highlight_rects`]: one clean band per line of a text highlight.
///
/// # Errors
///
/// Fails if `rects` is not an array of number arrays.
#[wasm_bindgen(js_name = normalizeHighlightRects)]
pub fn normalize_highlight_rects_js(rects: JsValue) -> JsResult<JsValue> {
    let rects: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(rects)?;
    to_js(&normalize_highlight_rects(&rects))
}

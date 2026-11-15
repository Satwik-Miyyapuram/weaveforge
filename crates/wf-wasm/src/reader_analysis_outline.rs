//! Outline-from-text helpers (Rust `reader_analysis::outline`). Each export wraps
//! one function; the JS names and shapes match
//! `packages/core/src/features/reader/outline-from-text.ts`.
//!
//! Objects cross as plain JS objects through serde; numbers cross as f64.
//! `isRotatedText` takes a `Float64Array`. The exports apply the defaults.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::outline as analysis_outline;
use wf_core::reader_analysis::outline::OutlineTextItem;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_rotated_text`](analysis_outline::is_rotated_text) (TS `isRotatedText`).
#[wasm_bindgen(js_name = isRotatedText)]
#[must_use]
pub fn is_rotated_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] transform: &[f64],
) -> bool {
    analysis_outline::is_rotated_text(transform)
}

/// [`body_font_size`](analysis_outline::body_font_size) (TS `bodyFontSize`).
///
/// # Errors
///
/// Fails if `pages` is not an array of arrays of text items.
#[wasm_bindgen(js_name = bodyFontSize)]
pub fn body_font_size_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly B.OutlineTextItem[])[]")]
    pages: JsValue,
) -> JsResult<f64> {
    let pages: Vec<Vec<OutlineTextItem>> = serde_wasm_bindgen::from_value(pages)?;
    Ok(analysis_outline::body_font_size(&pages))
}

#[wasm_bindgen(typescript_custom_section)]
const GROUP_RECURRING_LINES_TS: &str = r"
/** Lines grouped by (near-)identical text; the members are the caller's own line objects. */
export function groupRecurringLines<T>(lines: readonly T[], textOf: (line: T) => string, pageOf: (line: T) => number): { key: string; pages: Set<number>; members: T[] }[];
";

/// [`outline_from_text`](analysis_outline::outline_from_text) (TS `outlineFromText`).
///
/// # Errors
///
/// Fails if `allPages` is not an array of arrays of text items.
#[wasm_bindgen(js_name = outlineFromText, unchecked_return_type = "B.OutlineReaderItem[]")]
pub fn outline_from_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly B.OutlineTextItem[])[]")]
    all_pages: JsValue,
) -> JsResult<JsValue> {
    let all_pages: Vec<Vec<OutlineTextItem>> = serde_wasm_bindgen::from_value(all_pages)?;
    to_js(&analysis_outline::outline_from_text(&all_pages))
}

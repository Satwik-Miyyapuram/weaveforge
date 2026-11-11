//! Text lines, column detection and running-head keys for JavaScript (reader
//! analysis). Each export wraps a `wf_core::reader_analysis::lines` function;
//! objects cross as serde values and offsets are UTF-16 code units, as in the TS copy.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::lines::{
    AnalysisPageTextItem, AnalysisTaggedLine, AnalysisTextLine, AnalysisTextRun, detect_columns,
    furniture_key, is_bold_font, page_text_from_items, reconstruct_lines,
    sort_by_reading_order_indices,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`page_text_from_items`] over `{ str, hasEOL? }[]`.
///
/// # Errors
///
/// Fails if `items` is not an array of run objects.
#[wasm_bindgen(js_name = pageTextFromItems)]
pub fn page_text_from_items_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { str: string; hasEOL?: boolean }[]")]
    items: JsValue,
) -> JsResult<String> {
    let items: Vec<AnalysisTextRun> = serde_wasm_bindgen::from_value(items)?;
    Ok(page_text_from_items(&items))
}

/// [`is_bold_font`]; `fontName` may be undefined.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = isBoldFont)]
#[must_use]
pub fn is_bold_font_js(font_name: Option<String>) -> bool {
    is_bold_font(font_name.as_deref())
}

/// [`furniture_key`].
#[wasm_bindgen(js_name = furnitureKey)]
#[must_use]
pub fn furniture_key_js(s: &str) -> String {
    furniture_key(s)
}

/// [`reconstruct_lines`] as an array of `TextLine`. `keep` is an array of
/// per-item flags (the TS predicate, already applied) or undefined to keep all.
///
/// # Errors
///
/// Fails if `items` or `keep` is not an array of the expected shape.
#[wasm_bindgen(js_name = reconstructLines)]
pub fn reconstruct_lines_js(page: f64, items: JsValue, keep: JsValue) -> JsResult<JsValue> {
    let items: Vec<AnalysisPageTextItem> = serde_wasm_bindgen::from_value(items)?;
    let keep: Option<Vec<bool>> = if keep.is_undefined() || keep.is_null() {
        None
    } else {
        Some(serde_wasm_bindgen::from_value(keep)?)
    };
    to_js(&reconstruct_lines(page, &items, keep.as_deref()))
}

/// [`detect_columns`] as an array of 0-based column indices.
///
/// # Errors
///
/// Fails if `lines` is not an array of `TextLine` objects.
#[wasm_bindgen(js_name = detectColumns, unchecked_return_type = "number[]")]
pub fn detect_columns_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.TextLine[]")] lines: JsValue,
) -> JsResult<JsValue> {
    let lines: Vec<AnalysisTextLine> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&detect_columns(&lines))
}

/// [`sort_by_reading_order_indices`] as an array of input indices in reading order.
///
/// # Errors
///
/// Fails if `tagged` is not an array of `{ line, column }` objects.
#[wasm_bindgen(js_name = sortByReadingOrder)]
pub fn sort_by_reading_order_indices_js(tagged: JsValue) -> JsResult<JsValue> {
    let tagged: Vec<AnalysisTaggedLine> = serde_wasm_bindgen::from_value(tagged)?;
    to_js(&sort_by_reading_order_indices(&tagged))
}

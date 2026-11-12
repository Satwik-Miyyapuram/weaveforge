//! Text lines, column detection and running-head keys for JavaScript (reader
//! analysis). Each export wraps a `wf_core::reader_analysis::lines` function;
//! objects cross as serde values and offsets are UTF-16 code units, as in the TS copy.

use js_sys::{Array, Function, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::reader_analysis::lines::{
    AnalysisPageTextItem, AnalysisTaggedLine, AnalysisTextLine, AnalysisTextRun, detect_columns,
    furniture_key, is_bold_font, page_text_from_items, reconstruct_lines,
    sort_by_reading_order_indices,
};
use wf_core::search::js_text::is_js_whitespace;

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

/// [`reconstruct_lines`] as an array of `TextLine`. A run is kept when its text is not JS-blank
/// and `keep(item)` (default: always) is truthy; `keep` runs only on non-blank runs.
///
/// # Errors
///
/// Fails if `items` is not an array of the expected shape, or rethrows what `keep` throws.
#[wasm_bindgen(js_name = reconstructLines, unchecked_return_type = "B.AnalysisTextLine[]")]
pub fn reconstruct_lines_js(
    page: f64,
    #[wasm_bindgen(
        unchecked_param_type = "readonly { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }[]"
    )]
    items: JsValue,
    #[wasm_bindgen(
        unchecked_optional_param_type = "(item: { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }) => boolean"
    )]
    keep: Option<Function>,
) -> Result<JsValue, JsValue> {
    let runs: Vec<AnalysisPageTextItem> = serde_wasm_bindgen::from_value(items.clone())?;
    let objects: Array = items.unchecked_into();
    let mut flags = Vec::with_capacity(runs.len());
    for (run, object) in runs.iter().zip(objects.iter()) {
        let kept = if run.str.chars().all(is_js_whitespace) {
            false
        } else if let Some(keep) = &keep {
            keep.call1(&JsValue::UNDEFINED, &object)?.is_truthy()
        } else {
            true
        };
        flags.push(kept);
    }
    Ok(to_js(&reconstruct_lines(page, &runs, Some(&flags)))?)
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

/// [`sort_by_reading_order_indices`]: the caller's own `line` objects in reading order (page,
/// then column, then top to bottom).
///
/// # Errors
///
/// Fails if `tagged` is not an array of `{ line, column }` objects.
#[wasm_bindgen(js_name = sortByReadingOrder, unchecked_return_type = "B.AnalysisTextLine[]")]
pub fn sort_by_reading_order_indices_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { line: B.AnalysisTextLine; column: number }[]"
    )]
    tagged: JsValue,
) -> Result<JsValue, JsValue> {
    let rows: Vec<AnalysisTaggedLine> = serde_wasm_bindgen::from_value(tagged.clone())?;
    let objects: Array = tagged.unchecked_into();
    let objects: Vec<JsValue> = objects.iter().collect();
    let line = JsValue::from_str("line");
    let out = Array::new();
    for index in sort_by_reading_order_indices(&rows) {
        let object = objects.get(index).cloned().unwrap_or(JsValue::UNDEFINED);
        let _ = out.push(&Reflect::get(&object, &line)?);
    }
    Ok(out.into())
}

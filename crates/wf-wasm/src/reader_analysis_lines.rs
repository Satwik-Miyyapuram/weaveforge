//! Text lines, column detection and running-head keys for JavaScript (reader
//! analysis). Each export wraps a `wf_core::reader_analysis::lines` function;
//! objects cross as serde values and offsets are UTF-16 code units, as in the TS copy.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::lines::{
    AnalysisTextRun, furniture_key, is_bold_font, page_text_from_items,
};

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

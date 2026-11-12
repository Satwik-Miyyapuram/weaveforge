//! DOM selection mapping rules (`apps/web/src/features/reader/application/parts-1.ts`).
//! Wraps `wf_core::reader::dom_selection_range`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::dom_selection_range::{
    ItemTextOffset, page_span_of, text_selection_from_offsets,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`text_selection_from_offsets`]: a `TextSelectionRange` from two `{ itemIndex, offset }`
/// points, or `null` when the selection is empty or invalid.
///
/// # Errors
///
/// Fails if either point is not an `{ itemIndex, offset }` object.
#[wasm_bindgen(
    js_name = textSelectionFromOffsets,
    unchecked_return_type = "T.TextSelectionRange | null"
)]
pub fn text_selection_from_offsets_js(
    #[wasm_bindgen(unchecked_param_type = "{ itemIndex: number; offset: number }")] start: JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ itemIndex: number; offset: number }")] end: JsValue,
) -> JsResult<JsValue> {
    let start: ItemTextOffset = serde_wasm_bindgen::from_value(start)?;
    let end: ItemTextOffset = serde_wasm_bindgen::from_value(end)?;
    to_js(&text_selection_from_offsets(start, end))
}

/// [`page_span_of`]: the `{ startPage, endPage }` span of two resolved ends, or `null` when
/// neither end resolved to a page.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = pageSpanOf,
    unchecked_return_type = "{ startPage: number; endPage: number } | null"
)]
pub fn page_span_of_js(start_page: Option<f64>, end_page: Option<f64>) -> JsResult<JsValue> {
    to_js(&page_span_of(start_page, end_page))
}

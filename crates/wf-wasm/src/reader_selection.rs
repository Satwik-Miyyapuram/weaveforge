//! Text-selection anchors and text-item rects for JavaScript (`packages/core/src/reader/selection-to-anchor.ts`).
//! Each export wraps a `wf_core::reader::selection` function; objects cross as
//! serde values and offsets are UTF-16 code units, as in the TS copy.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::selection::{
    SelectionPageTextGeometry, SelectionPageTextItem, SelectionTextRange, item_to_rect,
    selection_to_anchor,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`selection_to_anchor`] as a `CombinedPdfAnchor`, or `null` when the selection is empty or out of range.
///
/// # Errors
///
/// Fails if `selection` or `page` is not the expected object shape, or the result cannot be converted.
#[wasm_bindgen(js_name = selectionToAnchor)]
pub fn selection_to_anchor_js(selection: JsValue, page: JsValue) -> JsResult<JsValue> {
    let selection: SelectionTextRange = serde_wasm_bindgen::from_value(selection)?;
    let page: SelectionPageTextGeometry = serde_wasm_bindgen::from_value(page)?;
    to_js(&selection_to_anchor(&selection, &page))
}

/// [`item_to_rect`] as `[x1, y1, x2, y2]`, or `null`. Omitted bounds take the TS defaults (`0` and `Infinity`).
///
/// # Errors
///
/// Fails if `item` is not a text item object, or the result cannot be converted.
#[wasm_bindgen(js_name = itemToRect)]
pub fn item_to_rect_js(
    item: JsValue,
    char_from: Option<f64>,
    char_to: Option<f64>,
) -> JsResult<JsValue> {
    let item: SelectionPageTextItem = serde_wasm_bindgen::from_value(item)?;
    to_js(&item_to_rect(
        &item,
        char_from.unwrap_or(0.0),
        char_to.unwrap_or(f64::INFINITY),
    ))
}

//! Text-selection anchors and text-item rects for JavaScript (`packages/core/src/reader/selection-to-anchor.ts`).
//! Each export wraps a `wf_core::reader::selection` function; objects cross as
//! serde values and offsets are UTF-16 code units, as in the TS copy.

use js_sys::{Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::reader::selection::{
    SelectionPageTextGeometry, SelectionPageTextItem, SelectionTextRange, item_to_rect,
    selection_to_anchor,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`selection_to_anchor`] as a `CombinedPdfAnchor`, or `null` when the selection is empty or out of range.
/// The anchor always carries a `contentHash` key, `undefined` when the page has none (as the TS copy did).
///
/// # Errors
///
/// Fails if `selection` or `page` is not the expected object shape, or the result cannot be converted.
#[wasm_bindgen(
    js_name = selectionToAnchor,
    unchecked_return_type = "T.CombinedPdfAnchor | null"
)]
pub fn selection_to_anchor_js(
    #[wasm_bindgen(unchecked_param_type = "B.SelectionTextRange")] selection: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "Omit<B.SelectionPageTextGeometry, \"items\"> & { items?: readonly B.SelectionPageTextItem[] }"
    )]
    page: JsValue,
) -> JsResult<JsValue> {
    let selection: SelectionTextRange = serde_wasm_bindgen::from_value(selection)?;
    let page: SelectionPageTextGeometry = serde_wasm_bindgen::from_value(page)?;
    let Some(anchor) = selection_to_anchor(&selection, &page) else {
        return Ok(JsValue::NULL);
    };
    // `{ contentHash: undefined, ...anchor }`: the key leads and is present even when unset.
    let out = Object::new();
    let _ = Reflect::set(&out, &JsValue::from_str("contentHash"), &JsValue::UNDEFINED)
        .map_err(|_| serde_wasm_bindgen::Error::new("cannot set contentHash"))?;
    let anchor = to_js(&anchor)?;
    Ok(Object::assign(&out, anchor.unchecked_ref()).into())
}

/// [`item_to_rect`] as `[x1, y1, x2, y2]`, or `null`. Omitted bounds take the TS defaults (`0` and `Infinity`).
///
/// # Errors
///
/// Fails if `item` is not a text item object, or the result cannot be converted.
#[wasm_bindgen(js_name = itemToRect, unchecked_return_type = "number[] | null")]
pub fn item_to_rect_js(
    #[wasm_bindgen(unchecked_param_type = "B.SelectionPageTextItem")] item: JsValue,
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

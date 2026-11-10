//! Margin comment card stacking (`apps/web/src/features/reader/application/margin-notes.ts`).
//! Wraps `wf_core::reader::margin_notes`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::margin_notes::{layout_margin_notes, stack_margin_notes, MarginMark};
use wf_core::reader::viewport::ReaderPageProjection;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`layout_margin_notes`]: `marks` is one `{ hasComment, hasPicture, geometry }` per
/// annotation and `projection` a page projection. Returns `{ index, top, anchorTop }[]` in
/// ascending `anchorTop` order, where `index` is the mark's position in `marks`.
///
/// # Errors
///
/// Fails if `marks` or `projection` do not have the expected shape.
#[wasm_bindgen(js_name = layoutMarginNotes)]
pub fn layout_margin_notes_js(marks: JsValue, projection: JsValue, card_height: f64) -> JsResult<JsValue> {
    let marks: Vec<MarginMark> = serde_wasm_bindgen::from_value(marks)?;
    let projection: ReaderPageProjection = serde_wasm_bindgen::from_value(projection)?;
    to_js(&layout_margin_notes(&marks, projection, card_height))
}

/// [`stack_margin_notes`]: `anchorTops` is a number array; returns `{ index, top, anchorTop }[]`
/// in ascending `anchorTop` order.
///
/// # Errors
///
/// Fails if `anchorTops` is not an array of numbers.
#[wasm_bindgen(js_name = stackMarginNotes)]
pub fn stack_margin_notes_js(anchor_tops: JsValue, card_height: f64) -> JsResult<JsValue> {
    let anchor_tops: Vec<f64> = serde_wasm_bindgen::from_value(anchor_tops)?;
    to_js(&stack_margin_notes(&anchor_tops, card_height))
}

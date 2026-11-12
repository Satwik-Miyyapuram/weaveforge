//! Mention geometry for JavaScript (`apps/web/src/features/reader/application/reference-locate.ts`).
//! Wraps `wf_core::reader::reference_locate`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::reference_locate::{PdfRect, locate_mention, union_rect};
use wf_core::reader::selection::SelectionPageTextItem;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`locate_mention`]: the rects and bounds a mention covers on its page.
///
/// # Errors
///
/// Fails if `items` is not an array of page text items.
#[wasm_bindgen(js_name = locateMention, unchecked_return_type = "B.MentionGeometry")]
pub fn locate_mention_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.SelectionPageTextItem[]")] items: JsValue,
    start: f64,
    end: f64,
) -> JsResult<JsValue> {
    let items: Vec<SelectionPageTextItem> = serde_wasm_bindgen::from_value(items)?;
    to_js(&locate_mention(&items, start, end))
}

/// [`union_rect`]: the box around a set of rects, or `null` when there are none.
///
/// # Errors
///
/// Fails if `rects` is not an array of `[x1, y1, x2, y2]` arrays.
#[wasm_bindgen(
    js_name = unionRect,
    unchecked_return_type = "[number, number, number, number] | null"
)]
pub fn union_rect_js(
    #[wasm_bindgen(unchecked_param_type = "readonly [number, number, number, number][]")]
    rects: JsValue,
) -> JsResult<JsValue> {
    let rects: Vec<PdfRect> = serde_wasm_bindgen::from_value(rects)?;
    to_js(&union_rect(&rects))
}

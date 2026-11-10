//! Where a page background sits on the A4 sheet (wf-core `ink::page_background`),
//! re-exported from `packages/wf-wasm/src/page-background.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::page_background;

use super::to_js;

/// [`place_on_sheet`](page_background::place_on_sheet) as `{ x, y, width, height }`.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = placeOnSheet, unchecked_return_type = "B.Placement")]
pub fn place_on_sheet_js(
    source_width: f64,
    source_height: f64,
    sheet_width: f64,
    sheet_height: f64,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&page_background::place_on_sheet(
        source_width,
        source_height,
        sheet_width,
        sheet_height,
    ))
}

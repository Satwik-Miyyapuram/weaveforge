//! Press snapping for the text layer (`apps/web/src/features/reader/ui/pdf-reader/text-snap.ts`).
//! Wraps `wf_core::reader::text_snap`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::text_snap::{TextRunBox, snap_to_text};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`snap_to_text`]: `runs` is `{ left, top, right, bottom }[]` (plain boxes, not DOMRects).
/// Returns `{ index, x, y }` or `null`.
///
/// # Errors
///
/// Fails if `runs` is not an array of `{ left, top, right, bottom }` objects.
#[wasm_bindgen(js_name = snapToText)]
pub fn snap_to_text_js(runs: JsValue, x: f64, y: f64) -> JsResult<JsValue> {
    let runs: Vec<TextRunBox> = serde_wasm_bindgen::from_value(runs)?;
    to_js(&snap_to_text(&runs, x, y))
}

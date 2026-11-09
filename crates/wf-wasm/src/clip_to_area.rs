//! The ink draw area and its cut (wf-core `ink::clip_to_area`), re-exported from
//! `packages/wf-wasm/src/clip-to-area.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::clip_to_area::{self as clip, DrawArea, Point};

use super::to_js;

/// [`point_in_area`](clip::point_in_area).
#[wasm_bindgen(js_name = pointInArea)]
pub fn point_in_area_js(area: JsValue, x: f64, y: f64) -> Result<bool, serde_wasm_bindgen::Error> {
    let area: DrawArea = serde_wasm_bindgen::from_value(area)?;
    Ok(clip::point_in_area(&area, x, y))
}

/// [`clip_segment_to_area`](clip::clip_segment_to_area) as `{ from, to }`, or `null`.
///
/// # Errors
///
/// Fails only if the arguments cannot be read or the result cannot be serialised.
#[wasm_bindgen(js_name = clipSegmentToArea)]
pub fn clip_segment_to_area_js(
    area: JsValue,
    from: JsValue,
    to: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let area: DrawArea = serde_wasm_bindgen::from_value(area)?;
    let from: Point = serde_wasm_bindgen::from_value(from)?;
    let to: Point = serde_wasm_bindgen::from_value(to)?;
    to_js(&clip::clip_segment_to_area(&area, from, to))
}

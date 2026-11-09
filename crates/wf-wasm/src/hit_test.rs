//! Lasso and erase hit tests for JavaScript (wf-core `ink::hit_test`), re-exported
//! from `packages/wf-wasm/src/hit-test.ts`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::ink::hit_test;

/// [`point_in_polygon`](hit_test::point_in_polygon) over a flat `x,y` array.
///
/// # Errors
///
/// Fails if `polygon` is not an array of numbers.
#[wasm_bindgen(js_name = inkPointInPolygon)]
pub fn ink_point_in_polygon_js(
    px: f64,
    py: f64,
    polygon: JsValue,
) -> Result<bool, serde_wasm_bindgen::Error> {
    let polygon: Vec<f64> = serde_wasm_bindgen::from_value(polygon)?;
    Ok(hit_test::point_in_polygon(px, py, &polygon))
}

/// [`distance_to_segment_squared`](hit_test::distance_to_segment_squared).
#[wasm_bindgen(js_name = distanceToSegmentSquared)]
#[must_use]
pub fn distance_to_segment_squared_js(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    hit_test::distance_to_segment_squared(px, py, ax, ay, bx, by)
}

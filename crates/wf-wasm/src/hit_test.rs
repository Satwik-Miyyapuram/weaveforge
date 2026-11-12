//! Lasso and erase hit tests for JavaScript (wf-core `ink::hit_test`), used by the ink worker.

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
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] polygon: JsValue,
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

/// [`stroke_near_segment`](hit_test::stroke_near_segment): whether a stroke passes within `radius` of a swept segment.
#[must_use]
#[wasm_bindgen(js_name = inkStrokeNearSegment)]
pub fn ink_stroke_near_segment_js(
    xs: &[f32],
    ys: &[f32],
    fx: f64,
    fy: f64,
    tx: f64,
    ty: f64,
    radius: f64,
) -> bool {
    hit_test::stroke_near_segment(xs, ys, (fx, fy), (tx, ty), radius)
}

/// [`lasso_keeps`](hit_test::lasso_keeps): whether a lasso polygon keeps a stroke (half its points inside).
#[must_use]
#[wasm_bindgen(js_name = inkLassoKeeps)]
pub fn ink_lasso_keeps_js(xs: &[f32], ys: &[f32], polygon: &[f64]) -> bool {
    hit_test::lasso_keeps(xs, ys, polygon)
}

/// [`polygon_bounds`](hit_test::polygon_bounds): `[minX, minY, maxX, maxY]` of a flat `x,y` polygon.
#[must_use]
#[wasm_bindgen(js_name = inkPolygonBounds)]
pub fn ink_polygon_bounds_js(
    #[wasm_bindgen(unchecked_param_type = "Float64Array")] polygon: &[f64],
) -> Vec<f64> {
    hit_test::polygon_bounds(polygon).to_vec()
}

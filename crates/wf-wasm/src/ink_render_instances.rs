//! Ink render instance maths for JavaScript: the WebGL stroke renderer's
//! packer, backing-store ratio and highlighter test. Each export wraps a
//! `wf_core::ink::render_instances` function. Point arrays cross as
//! `Float64Array`s (flat x values, flat y values).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::render_instances::{
    backing_ratio, pack_stroke_instances, stroke_instance_count, uses_highlighter_pass,
};

/// [`stroke_instance_count`]: the instances a stroke of `points` samples packs to.
#[wasm_bindgen(js_name = inkStrokeInstanceCount)]
#[must_use]
// The count is at most a small multiple of a u32 point count, well inside u32 in practice.
#[allow(clippy::cast_possible_truncation)]
pub fn ink_stroke_instance_count_js(points: u32) -> u32 {
    stroke_instance_count(points as usize) as u32
}

/// [`pack_stroke_instances`]: the instance floats for a stroke from span `from`
/// on (default 0), as a `Float64Array` the caller narrows into its buffer.
#[wasm_bindgen(js_name = packInkStrokeInstances)]
#[must_use]
pub fn pack_ink_stroke_instances_js(
    #[wasm_bindgen(unchecked_param_type = "ArrayLike<number>")] xs: &[f64],
    #[wasm_bindgen(unchecked_param_type = "ArrayLike<number>")] ys: &[f64],
    width: f64,
    from: Option<u32>,
) -> Vec<f64> {
    pack_stroke_instances(xs, ys, width, from.unwrap_or(0) as usize)
}

/// [`backing_ratio`]: the pixel ratio a canvas of the given CSS size is given.
#[wasm_bindgen(js_name = inkBackingRatio)]
#[must_use]
pub fn ink_backing_ratio_js(css_width: f64, css_height: f64, device_pixel_ratio: f64) -> f64 {
    backing_ratio(css_width, css_height, device_pixel_ratio)
}

/// [`uses_highlighter_pass`]: whether a tool is drawn translucent through the stencil.
#[wasm_bindgen(js_name = usesInkHighlighterPass)]
#[must_use]
pub fn uses_ink_highlighter_pass_js(tool: &str) -> bool {
    uses_highlighter_pass(tool)
}

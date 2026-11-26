//! Ink canvas maths for JavaScript: the backing-store ratio and highlighter
//! test. Each export wraps a `wf_core::ink::render_instances` function.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::render_instances::{backing_ratio, uses_highlighter_pass};

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

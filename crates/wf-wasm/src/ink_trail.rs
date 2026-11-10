//! Ink trail diameter for JavaScript (wf-core `ink::trail`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::trail;

/// [`trail_diameter_px`](trail::trail_diameter_px): the trail's diameter in CSS px for a
/// nib width in 0.1 mm on a page `page_width_px` wide.
#[wasm_bindgen(js_name = trailDiameterPx)]
pub fn trail_diameter_px_js(width: f64, page_width_px: f64) -> f64 {
    trail::trail_diameter_px(width, page_width_px)
}

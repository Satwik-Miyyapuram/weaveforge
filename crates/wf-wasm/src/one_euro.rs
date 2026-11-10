//! 1-Euro filter smoothing factor for JavaScript (wf-core `ink::one_euro`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::one_euro;

/// [`one_euro_alpha`](one_euro::one_euro_alpha): the smoothing factor for a cutoff in
/// hertz and a timestep in milliseconds.
#[wasm_bindgen(js_name = oneEuroAlpha)]
pub fn one_euro_alpha_js(cutoff: f64, dt_ms: f64) -> f64 {
    one_euro::one_euro_alpha(cutoff, dt_ms)
}

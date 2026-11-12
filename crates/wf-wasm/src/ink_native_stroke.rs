//! A native shell's flat stroke as capture samples for JavaScript (wf-core
//! `ink::native_stroke`). One call per stroke at pen-lift.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::native_stroke;

/// [`flat_stroke_samples`](native_stroke::flat_stroke_samples): `[x, y, pressure, t, …]`
/// view pixels in, `x, y, pressure, t` quadruples in CSS pixels out. Takes `Float64Array`
/// because `t` is the device uptime in ms, which `Float32Array` would round.
#[must_use]
#[wasm_bindgen(js_name = inkFlatStrokeSamples)]
pub fn ink_flat_stroke_samples_js(points: &[f64], dpr: f64) -> Vec<f64> {
    native_stroke::flat_stroke_samples(points, dpr)
}

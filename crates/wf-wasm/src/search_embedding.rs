//! Vector normalization for JavaScript (wf-core `search::embedding`). The JS name
//! matches `packages/core/src/search/embedding-port.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::embedding;

/// [`normalize_vector`](embedding::normalize_vector). Returns a new `Float32Array`.
#[wasm_bindgen(js_name = normalizeVector)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes vectors by value"
)]
pub fn normalize_vector_js(vector: Vec<f32>) -> Vec<f32> {
    embedding::normalize_vector(&vector)
}

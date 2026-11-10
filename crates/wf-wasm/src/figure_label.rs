//! Experiment artifact labels for JavaScript (wf-core `figure_label`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::figure_label;

/// [`figure_label`](figure_label::figure_label): the label for an artifact URL. `index` is 0-based.
#[wasm_bindgen(js_name = figureLabel)]
#[must_use]
pub fn figure_label_js(url: &str, index: u32) -> String {
    figure_label::figure_label(url, index)
}

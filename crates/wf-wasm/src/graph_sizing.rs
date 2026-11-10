//! Graph node and label sizes at a zoom (wf-core `relations::graph_sizing`). The TS wrappers in
//! `packages/wf-wasm/src/graph-sizing.ts` keep the `kind` argument and map it to the tag flag.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_sizing;

use super::to_js;

/// [`node_size`](graph_sizing::node_size) as `{ r, line, drop, hit }`.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = nodeSize)]
pub fn node_size_js(
    base_r: f64,
    zoom: f64,
    bounded: bool,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&graph_sizing::node_size(base_r, zoom, bounded))
}

/// [`label_size`](graph_sizing::label_size) as `{ font, line, gap }`.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = labelSize)]
pub fn label_size_js(
    is_tag: bool,
    zoom: f64,
    bounded: bool,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&graph_sizing::label_size(is_tag, zoom, bounded))
}

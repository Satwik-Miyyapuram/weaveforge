//! Graph node and label sizes at a zoom (wf-core `relations::graph_sizing`). `labelSize` takes the
//! node `kind` and maps it to the tag flag.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_sizing;

use super::to_js;

/// [`node_size`](graph_sizing::node_size) as `{ r, line, drop, hit }`.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = nodeSize, unchecked_return_type = "B.NodeSize")]
pub fn node_size_js(
    base_r: f64,
    zoom: f64,
    bounded: Option<bool>,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&graph_sizing::node_size(
        base_r,
        zoom,
        bounded.unwrap_or(true),
    ))
}

/// [`label_size`](graph_sizing::label_size) as `{ font, line, gap }`: how big a label draws at
/// `zoom`. `kind === "tag"` picks the tag label's base size; `bounded` defaults to `true`.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = labelSize, unchecked_return_type = "B.LabelSize")]
pub fn label_size_js(
    kind: &str,
    zoom: f64,
    bounded: Option<bool>,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&graph_sizing::label_size(
        kind == "tag",
        zoom,
        bounded.unwrap_or(true),
    ))
}

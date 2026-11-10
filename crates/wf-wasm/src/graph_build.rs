//! Citation-graph builder for JavaScript (wf-core `relations::graph_build`). The JS
//! name matches `apps/web/src/features/relations/application/build-graph-data.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_build::{self, GraphBuildInput};

use super::to_js;

/// [`build_graph_data`](graph_build::build_graph_data): nodes, links and lookups for one graph view.
///
/// # Errors
///
/// Fails if the input has the wrong shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = buildGraphData)]
pub fn build_graph_data_js(input: JsValue) -> Result<JsValue, JsValue> {
    let input: GraphBuildInput = serde_wasm_bindgen::from_value(input)?;
    Ok(to_js(&graph_build::build_graph_data(&input))?)
}

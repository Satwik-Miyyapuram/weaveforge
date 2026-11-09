//! Local graph subgraph for JavaScript (wf-core `relations::local_graph`). The JS name matches
//! `localSubgraph` in `apps/web/src/features/relations/application/local-graph.ts`.

use std::collections::HashMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::local_graph::local_subgraph;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`local_subgraph`] (TS `localSubgraph`). `neighbors` is an array of `[id, neighbourIds]` pairs.
///
/// # Errors
///
/// Fails if `neighbors` is not an array of `[string, string[]]` pairs.
#[wasm_bindgen(js_name = localSubgraph)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn local_subgraph_js(
    seed: Option<String>,
    depth: f64,
    neighbors: JsValue,
) -> JsResult<JsValue> {
    let pairs: Vec<(String, Vec<String>)> = serde_wasm_bindgen::from_value(neighbors)?;
    let neighbors: HashMap<String, Vec<String>> = pairs.into_iter().collect();
    to_js(&local_subgraph(seed.as_deref(), depth, &neighbors))
}

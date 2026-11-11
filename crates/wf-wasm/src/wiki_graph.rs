//! Wiki-link graph helpers for JavaScript (wf-core `search::wiki_graph`). The JS names match
//! `packages/core/src/search/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::wiki_graph::{self, GraphDensity, WikiGraph, WikiGraphDegree};
use wf_core::sync::workspace_snapshot::WorkspaceSnapshot;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`build_wiki_graph`](wiki_graph::build_wiki_graph).
///
/// # Errors
///
/// Fails if `snapshot` has the wrong shape.
#[wasm_bindgen(js_name = buildWikiGraph)]
pub fn build_wiki_graph_js(snapshot: JsValue) -> JsResult<JsValue> {
    let snapshot: WorkspaceSnapshot = serde_wasm_bindgen::from_value(snapshot)?;
    to_js(&wiki_graph::build_wiki_graph(&snapshot))
}

/// [`graph_degrees`](wiki_graph::graph_degrees), as `{ node, degree }` rows.
///
/// # Errors
///
/// Fails if `graph` has the wrong shape.
#[wasm_bindgen(js_name = graphDegrees)]
pub fn graph_degrees_js(graph: JsValue) -> JsResult<JsValue> {
    let graph: WikiGraph = serde_wasm_bindgen::from_value(graph)?;
    let rows: Vec<WikiGraphDegree> = wiki_graph::graph_degrees(&graph);
    to_js(&rows)
}

/// [`graph_density`](wiki_graph::graph_density).
///
/// # Errors
///
/// Fails if `graph` has the wrong shape.
#[wasm_bindgen(js_name = graphDensity)]
pub fn graph_density_js(graph: JsValue) -> JsResult<JsValue> {
    let graph: WikiGraph = serde_wasm_bindgen::from_value(graph)?;
    let density: GraphDensity = wiki_graph::graph_density(&graph);
    to_js(&density)
}

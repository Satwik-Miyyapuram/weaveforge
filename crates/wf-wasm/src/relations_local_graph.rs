//! Local graph subgraph for JavaScript (wf-core `relations::local_graph`). The JS name matches
//! `localSubgraph` in `apps/web/src/features/relations/application/local-graph.ts`.

use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::local_graph::{
    clone_links, filter_graph_by_nodes, link_node_id, local_subgraph,
};

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

/// [`link_node_id`] (TS `linkNodeId`). `source` is a string endpoint or an endpoint object; the
/// result is the id, or `null` when there is none.
///
/// # Errors
///
/// Fails if `source` cannot be read as a JSON value.
#[wasm_bindgen(js_name = linkNodeId)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn link_node_id_js(source: JsValue) -> JsResult<JsValue> {
    let source: Value = serde_wasm_bindgen::from_value(source)?;
    to_js(&link_node_id(&source))
}

/// [`filter_graph_by_nodes`] (TS `filterGraphByNodes`). `allowed` is an array of node ids, or
/// `null` to keep everything. Returns `{ nodes, links }`.
///
/// # Errors
///
/// Fails if `nodes` or `links` is not an array of JSON values, or `allowed` is not an array of
/// strings or `null`.
#[wasm_bindgen(js_name = filterGraphByNodes)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn filter_graph_by_nodes_js(
    nodes: JsValue,
    links: JsValue,
    allowed: JsValue,
) -> JsResult<JsValue> {
    let nodes: Vec<Value> = serde_wasm_bindgen::from_value(nodes)?;
    let links: Vec<Value> = serde_wasm_bindgen::from_value(links)?;
    let allowed: Option<Vec<String>> = serde_wasm_bindgen::from_value(allowed)?;
    let allowed: Option<HashSet<String>> = allowed.map(|ids| ids.into_iter().collect());
    let (nodes, links) = filter_graph_by_nodes(&nodes, &links, allowed.as_ref());
    to_js(&json!({ "nodes": nodes, "links": links }))
}

/// [`clone_links`] (TS `cloneLinks`): links with string endpoints, every other field kept.
///
/// # Errors
///
/// Fails if `links` is not an array of JSON values.
#[wasm_bindgen(js_name = cloneLinks)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn clone_links_js(links: JsValue) -> JsResult<JsValue> {
    let links: Vec<Value> = serde_wasm_bindgen::from_value(links)?;
    to_js(&clone_links(&links))
}

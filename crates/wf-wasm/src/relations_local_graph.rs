//! Local graph subgraph for JavaScript (wf-core `relations::local_graph`). The JS names match
//! `apps/web/src/features/relations/application/local-graph.ts`.

use std::collections::{HashMap, HashSet};

use js_sys::Set;
use serde_json::{Value, json};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::local_graph::{
    clone_links, filter_graph_by_nodes, link_node_id, local_subgraph,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`local_subgraph`] (TS `localSubgraph`): the nodes within `depth` hops of `seed`, the seed
/// included, as a `Set`, or `null` when there is no seed or `depth` is below 1.
///
/// # Errors
///
/// Fails if `neighbors` is not a map of ids to iterables of ids.
#[wasm_bindgen(js_name = localSubgraph, unchecked_return_type = "Set<string> | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn local_subgraph_js(
    #[wasm_bindgen(unchecked_param_type = "string | null")] seed: Option<String>,
    depth: f64,
    #[wasm_bindgen(unchecked_param_type = "Map<string, Set<string>>")] neighbors: JsValue,
) -> JsResult<JsValue> {
    // A JS `Map` iterates as `[id, Set]` pairs, and each `Set` reads as a list.
    let neighbors: HashMap<String, Vec<String>> = serde_wasm_bindgen::from_value(neighbors)?;
    Ok(
        local_subgraph(seed.as_deref(), depth, &neighbors).map_or(JsValue::NULL, |ids| {
            let set = Set::new(&JsValue::UNDEFINED);
            for id in ids {
                let _ = set.add(&JsValue::from(id));
            }
            set.into()
        }),
    )
}

/// [`link_node_id`] (TS `linkNodeId`). `source` is a string endpoint or an endpoint object; the
/// result is the id, or `null` when there is none.
///
/// # Errors
///
/// Fails if `source` cannot be read as a JSON value.
#[wasm_bindgen(js_name = linkNodeId, unchecked_return_type = "string")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn link_node_id_js(
    #[wasm_bindgen(unchecked_param_type = "string | { id: string }")] source: JsValue,
) -> JsResult<JsValue> {
    let source: Value = serde_wasm_bindgen::from_value(source)?;
    to_js(&link_node_id(&source))
}

#[wasm_bindgen(typescript_custom_section)]
const LOCAL_GRAPH_TS: &str = r#"
/**
 * The nodes whose id is in `allowed` (all of them when `null`), and the links whose two
 * endpoints both remain. Works on copies: the inputs are not mutated.
 */
export function filterGraphByNodes<T extends { id: string }, L extends Record<"source" | "target", string | { id: string }>>(nodes: T[], links: L[], allowed: Set<string> | null): { nodes: T[]; links: L[] };
/** Copies of the links with string endpoints, every other field kept. */
export function cloneLinks<L extends Record<"source" | "target", string | { id: string }>>(links: L[]): (L & Record<"source" | "target", string>)[];
"#;

/// [`filter_graph_by_nodes`] (TS `filterGraphByNodes`). `allowed` is a `Set` (or array) of node
/// ids, or `null` to keep everything. Returns `{ nodes, links }`. Typed by the custom section
/// above, since its TS signature is generic.
///
/// # Errors
///
/// Fails if `nodes` or `links` is not an array of JSON values, or `allowed` is not an iterable of
/// strings or `null`.
#[wasm_bindgen(js_name = filterGraphByNodes, skip_typescript)]
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
/// Typed by the custom section above, since its TS signature is generic.
///
/// # Errors
///
/// Fails if `links` is not an array of JSON values.
#[wasm_bindgen(js_name = cloneLinks, skip_typescript)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn clone_links_js(links: JsValue) -> JsResult<JsValue> {
    let links: Vec<Value> = serde_wasm_bindgen::from_value(links)?;
    to_js(&clone_links(&links))
}

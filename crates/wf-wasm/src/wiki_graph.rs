//! Wiki-link graph helpers for JavaScript (wf-core `search::wiki_graph`). The JS names match
//! `packages/core/src/search/parts.ts`. JS holds the graph as `{ nodes, edges: Map }`; the
//! core holds `edges` as `{ node, neighbours }` rows, so these exports convert both ways.

use js_sys::{Array, Map, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::search::wiki_graph::{self, GraphDensity, WikiGraph, WikiGraphDegree, WikiGraphEdges};
use wf_core::sync::workspace_snapshot::WorkspaceSnapshot;

use super::to_js;

/// A JS `{ nodes, edges: Map<string, string[]> }` graph as the core's [`WikiGraph`],
/// edges in the `Map`'s insertion order.
///
/// # Errors
///
/// Fails if `nodes` is not a string array, `edges` is not a `Map`, or a neighbour list is not
/// a string array.
pub(crate) fn graph_from_js(graph: &JsValue) -> Result<WikiGraph, JsValue> {
    let nodes: Vec<String> =
        serde_wasm_bindgen::from_value(Reflect::get(graph, &JsValue::from_str("nodes"))?)?;
    let edges: Map = Reflect::get(graph, &JsValue::from_str("edges"))?
        .dyn_into()
        .map_err(|_| JsValue::from(js_sys::TypeError::new("graph.edges is not a Map")))?;
    let mut pairs = Vec::new();
    edges.for_each(&mut |neighbours, node| pairs.push((node, neighbours)));
    let mut rows = Vec::with_capacity(pairs.len());
    for (node, neighbours) in pairs {
        rows.push(WikiGraphEdges {
            node: serde_wasm_bindgen::from_value(node)?,
            neighbours: serde_wasm_bindgen::from_value(neighbours)?,
        });
    }
    Ok(WikiGraph { nodes, edges: rows })
}

/// The core's [`WikiGraph`] as a JS `{ nodes, edges: Map<string, string[]> }`.
fn graph_to_js(graph: &WikiGraph) -> Result<JsValue, JsValue> {
    let nodes: Array = graph.nodes.iter().map(|n| JsValue::from_str(n)).collect();
    let edges = Map::new();
    for row in &graph.edges {
        let neighbours: Array = row
            .neighbours
            .iter()
            .map(|n| JsValue::from_str(n))
            .collect();
        let _ = edges.set(&JsValue::from_str(&row.node), &neighbours);
    }
    let out = Object::new();
    let _ = Reflect::set(&out, &JsValue::from_str("nodes"), &nodes)?;
    let _ = Reflect::set(&out, &JsValue::from_str("edges"), &edges)?;
    Ok(out.into())
}

/// [`build_wiki_graph`](wiki_graph::build_wiki_graph): nodes `kind:id`, undirected adjacency in
/// insertion order.
///
/// # Errors
///
/// Fails if `snapshot` has the wrong shape.
#[wasm_bindgen(
    js_name = buildWikiGraph,
    unchecked_return_type = "{ nodes: string[]; edges: Map<string, string[]> }"
)]
pub fn build_wiki_graph_js(
    #[wasm_bindgen(unchecked_param_type = "object")] snapshot: JsValue,
) -> Result<JsValue, JsValue> {
    let snapshot: WorkspaceSnapshot = serde_wasm_bindgen::from_value(snapshot)?;
    graph_to_js(&wiki_graph::build_wiki_graph(&snapshot))
}

/// [`graph_degrees`](wiki_graph::graph_degrees): link count per node, for `SearchDoc.degree`.
///
/// # Errors
///
/// Fails if `graph` has the wrong shape.
#[wasm_bindgen(js_name = graphDegrees, unchecked_return_type = "Map<string, number>")]
pub fn graph_degrees_js(
    #[wasm_bindgen(unchecked_param_type = "{ nodes: string[]; edges: Map<string, string[]> }")]
    graph: JsValue,
) -> Result<JsValue, JsValue> {
    let rows: Vec<WikiGraphDegree> = wiki_graph::graph_degrees(&graph_from_js(&graph)?);
    let out = Map::new();
    for row in &rows {
        let _ = out.set(
            &JsValue::from_str(&row.node),
            &JsValue::from_f64(row.degree),
        );
    }
    Ok(out.into())
}

/// [`graph_density`](wiki_graph::graph_density): node and edge counts, mean degree, largest
/// component share.
///
/// # Errors
///
/// Fails if `graph` has the wrong shape.
#[wasm_bindgen(js_name = graphDensity, unchecked_return_type = "B.GraphDensity")]
pub fn graph_density_js(
    #[wasm_bindgen(unchecked_param_type = "{ nodes: string[]; edges: Map<string, string[]> }")]
    graph: JsValue,
) -> Result<JsValue, JsValue> {
    let density: GraphDensity = wiki_graph::graph_density(&graph_from_js(&graph)?);
    Ok(to_js(&density)?)
}

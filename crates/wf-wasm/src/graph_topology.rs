//! Graph simulation restart key (wf-core `relations::graph_topology`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_topology::{self as topology, TopologyInput};

/// [`graph_topology_key`](topology::graph_topology_key): what the simulation is laid out over; a
/// change to the returned key restarts it. `shown` is `{ nodes, links }` with `id` on each entry.
///
/// # Errors
///
/// Fails if `shown` has the wrong shape.
#[wasm_bindgen(js_name = graphTopologyKey)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn graph_topology_key_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ nodes: readonly { id: string }[]; links: readonly { id: string }[] }"
    )]
    shown: JsValue,
    #[wasm_bindgen(unchecked_param_type = "string | null")] local_seed: Option<String>,
    local_depth: f64,
) -> Result<String, serde_wasm_bindgen::Error> {
    let shown: TopologyInput = serde_wasm_bindgen::from_value(shown)?;
    Ok(topology::graph_topology_key(
        &shown,
        local_seed.as_deref(),
        local_depth,
    ))
}

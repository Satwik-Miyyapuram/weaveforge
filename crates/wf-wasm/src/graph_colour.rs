//! Graph palette, tag colours and graph-wide recolouring for JavaScript (wf-core
//! `relations::graph_colour`). The JS names match
//! `apps/web/src/features/relations/domain/graph-palette.ts` and
//! `apps/web/src/features/relations/application/node-colouring.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_colour::{self, ColourableNode, LinkEnds, RecolourContext};
use wf_core::relations::graph_settings::ColorGroup;

use super::to_js;

/// [`graph_palette`](graph_colour::graph_palette): every fixed colour the graph draws.
///
/// # Errors
///
/// Fails only if the palette cannot be serialised.
#[wasm_bindgen(js_name = graphPalette)]
pub fn graph_palette_js() -> Result<JsValue, JsValue> {
    Ok(to_js(&graph_colour::graph_palette())?)
}

/// [`tag_colour`](graph_colour::tag_colour): the hue for a tag.
#[wasm_bindgen(js_name = tagColor)]
pub fn tag_colour_js(tag: &str) -> String {
    graph_colour::tag_colour(tag)
}

/// [`recolour_nodes`](graph_colour::recolour_nodes): one colour per node in order, or
/// `null` when the mode leaves node colours as built.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = recolourNodes)]
pub fn recolour_nodes_js(
    nodes: JsValue,
    links: JsValue,
    color_by: &str,
    groups: JsValue,
    ctx: JsValue,
) -> Result<JsValue, JsValue> {
    let nodes: Vec<ColourableNode> = serde_wasm_bindgen::from_value(nodes)?;
    let links: Vec<LinkEnds> = serde_wasm_bindgen::from_value(links)?;
    let groups: Vec<ColorGroup> = serde_wasm_bindgen::from_value(groups)?;
    let ctx: RecolourContext = serde_wasm_bindgen::from_value(ctx)?;
    Ok(to_js(&graph_colour::recolour_nodes(
        &nodes, &links, color_by, &groups, &ctx,
    ))?)
}

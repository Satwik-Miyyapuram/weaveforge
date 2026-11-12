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
#[wasm_bindgen(
    js_name = graphPalette,
    unchecked_return_type = "{ relation: Record<string, string>; readingStatus: Record<string, string>; note: string; paper: string; wikilink: string; report: string; experiment: string; experimentLink: string; uncoloured: string; rampGradient: string; cluster: string[] }"
)]
pub fn graph_palette_js() -> Result<JsValue, JsValue> {
    Ok(to_js(&graph_colour::graph_palette())?)
}

/// [`tag_colour`](graph_colour::tag_colour): the hue for a tag.
#[wasm_bindgen(js_name = tagColor)]
pub fn tag_colour_js(tag: &str) -> String {
    graph_colour::tag_colour(tag)
}

/// The node and lookup shapes [`recolour_nodes_js`] takes. `ColourableNode` and
/// `RecolourContext` read plain objects; these are the caller's shapes, with `Map`s.
#[wasm_bindgen(typescript_custom_section)]
const RECOLOUR_TS: &str = r"
/** The node fields recolouring reads. `color` is written back in place. */
export interface RecolourableNode {
  id: string;
  label: string;
  color: string;
  paperId?: string;
  year?: number;
  tagName?: string;
}

/** The lookups recolouring needs beyond the nodes and links. */
export interface RecolourLookups {
  papers: ReadonlyMap<string, { id: string; title: string; status?: string; tags: readonly string[] }>;
  /** Hashtags per note id. */
  noteTags: ReadonlyMap<string, readonly string[]>;
  /** Paper ids per list id. */
  membership: ReadonlyMap<string, ReadonlySet<string>>;
  lists: readonly { id: string; name: string }[];
}
";

/// `ctx` with its `Map`s as plain objects and each membership `Set` as an array, the
/// shape [`RecolourContext`] deserializes.
fn recolour_context(ctx: &JsValue) -> Result<RecolourContext, JsValue> {
    let field = |name: &str| js_sys::Reflect::get(ctx, &JsValue::from_str(name));
    let wire = js_sys::Object::new();
    let papers = js_sys::Object::from_entries(&field("papers")?)?;
    let _ = js_sys::Reflect::set(&wire, &JsValue::from_str("papers"), &papers)?;
    let note_tags = js_sys::Object::from_entries(&field("noteTags")?)?;
    let _ = js_sys::Reflect::set(&wire, &JsValue::from_str("noteTags"), &note_tags)?;
    let membership = js_sys::Object::new();
    for entry in js_sys::Array::from(&field("membership")?).iter() {
        let pair = js_sys::Array::from(&entry);
        let ids = js_sys::Array::from(&pair.get(1));
        let _ = js_sys::Reflect::set(&membership, &pair.get(0), &ids)?;
    }
    let _ = js_sys::Reflect::set(&wire, &JsValue::from_str("membership"), &membership)?;
    let _ = js_sys::Reflect::set(&wire, &JsValue::from_str("lists"), &field("lists")?)?;
    Ok(serde_wasm_bindgen::from_value(wire.into())?)
}

/// [`recolour_nodes`](graph_colour::recolour_nodes): applies a graph-wide colour mode
/// (`year`, `degree`, `cluster`, `groups`) by writing each node's `color` in place. Other
/// modes leave the nodes as built.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[wasm_bindgen(js_name = recolourNodes)]
pub fn recolour_nodes_js(
    #[wasm_bindgen(unchecked_param_type = "RecolourableNode[]")] nodes: &JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly { source: string; target: string }[]")]
    links: JsValue,
    color_by: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly { query: string; color: string }[]")]
    groups: JsValue,
    #[wasm_bindgen(unchecked_param_type = "RecolourLookups")] ctx: &JsValue,
) -> Result<(), JsValue> {
    let parsed: Vec<ColourableNode> = serde_wasm_bindgen::from_value(nodes.clone())?;
    let links: Vec<LinkEnds> = serde_wasm_bindgen::from_value(links)?;
    let groups: Vec<ColorGroup> = serde_wasm_bindgen::from_value(groups)?;
    let ctx = recolour_context(ctx)?;
    if let Some(colours) = graph_colour::recolour_nodes(&parsed, &links, color_by, &groups, &ctx) {
        for (index, colour) in (0_u32..).zip(colours) {
            let node = js_sys::Reflect::get_u32(nodes, index)?;
            let _ = js_sys::Reflect::set(
                &node,
                &JsValue::from_str("color"),
                &JsValue::from_str(&colour),
            )?;
        }
    }
    Ok(())
}

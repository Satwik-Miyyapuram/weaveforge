//! Graph node colours for JavaScript (wf-core `relations::node_colouring`). The JS
//! names match `apps/web/src/features/relations/application/node-colouring.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::node_colouring;

use super::to_js;

/// [`ramp_colour`](node_colouring::ramp_colour): a colour `t` of the way along the ramp.
#[wasm_bindgen(js_name = rampColour)]
pub fn ramp_colour_js(t: f64) -> String {
    node_colouring::ramp_colour(t)
}

/// [`year_colours`](node_colouring::year_colours): `[id, colour]` pairs for `[id, year]` pairs.
///
/// # Errors
///
/// Fails if `years` is not an array of `[id, number]` pairs.
#[wasm_bindgen(js_name = yearColours, unchecked_return_type = "[string, string][]")]
pub fn year_colours_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly [string, number])[]")] years: JsValue,
) -> Result<JsValue, JsValue> {
    let years: Vec<(String, f64)> = serde_wasm_bindgen::from_value(years)?;
    Ok(to_js(&node_colouring::year_colours(&years))?)
}

/// [`degree_colours`](node_colouring::degree_colours): `[id, colour]` pairs for `[id, degree]` pairs.
///
/// # Errors
///
/// Fails if `degree` is not an array of `[id, number]` pairs.
#[wasm_bindgen(js_name = degreeColours, unchecked_return_type = "[string, string][]")]
pub fn degree_colours_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly [string, number])[]")]
    degree: JsValue,
) -> Result<JsValue, JsValue> {
    let degree: Vec<(String, f64)> = serde_wasm_bindgen::from_value(degree)?;
    Ok(to_js(&node_colouring::degree_colours(&degree))?)
}

/// [`communities`](node_colouring::communities): `[id, rank]` pairs, rank 0 for the biggest.
///
/// # Errors
///
/// Fails if `ids` or `edges` has the wrong shape.
#[wasm_bindgen(js_name = communities, unchecked_return_type = "[string, number][]")]
pub fn communities_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] ids: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly [string, string])[]")] edges: JsValue,
) -> Result<JsValue, JsValue> {
    let ids: Vec<String> = serde_wasm_bindgen::from_value(ids)?;
    let edges: Vec<(String, String)> = serde_wasm_bindgen::from_value(edges)?;
    Ok(to_js(&node_colouring::communities(&ids, &edges))?)
}

//! Timeline layout lanes (wf-core `relations::graph_timeline`).

use js_sys::{Array, Reflect};
use wasm_bindgen::JsValue;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_timeline as timeline;

/// A node's `year`, `None` when it is `null` or missing.
fn year_of(node: &JsValue) -> Option<JsValue> {
    Reflect::get(node, &JsValue::from_str("year"))
        .ok()
        .filter(|year| !year.is_undefined() && !year.is_null())
}

/// [`YEAR_SPACING`](timeline::YEAR_SPACING): canvas units between one publication year and the next.
#[wasm_bindgen(js_name = yearSpacing)]
#[must_use]
pub fn timeline_year_spacing() -> f64 {
    timeline::YEAR_SPACING
}

/// [`timeline_mid_year`](timeline::timeline_mid_year). `years` is an array of years, `null` where unknown.
///
/// # Errors
///
/// Fails if `years` is not an array of optional numbers.
#[wasm_bindgen(js_name = timelineMidYear, unchecked_return_type = "number | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn timeline_mid_year_js(
    layout: &str,
    #[wasm_bindgen(unchecked_param_type = "(number | null)[]")] years: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let years: Vec<Option<f64>> = serde_wasm_bindgen::from_value(years)?;
    let mid = timeline::timeline_mid_year(layout, &years);
    Ok(mid.map_or(JsValue::NULL, JsValue::from))
}

/// [`timeline_lane_offset`](timeline::timeline_lane_offset).
#[wasm_bindgen(js_name = timelineLaneOffset, unchecked_return_type = "number | null")]
#[must_use]
pub fn timeline_lane_offset_js(mid: f64, year: Option<f64>) -> JsValue {
    timeline::timeline_lane_offset(mid, year).map_or(JsValue::NULL, JsValue::from)
}

/// The timeline layout: each node's x is fixed to its publication year, centred on the mean year
/// of the collection; a node without a year gets `null` and is left to the forces. Returns `null`
/// when the layout is not `"timeline"` or no node has a year.
///
/// # Errors
///
/// Fails if a node's `year` is neither a number nor `null`.
#[wasm_bindgen(
    js_name = timelineLaneX,
    unchecked_return_type = "((node: { year?: number | null }) => number | null) | null"
)]
pub fn timeline_lane_x_js(
    layout: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly { year?: number | null }[]")] nodes: &Array,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let years = nodes
        .iter()
        .map(|node| {
            year_of(&node)
                .map(serde_wasm_bindgen::from_value)
                .transpose()
        })
        .collect::<Result<Vec<Option<f64>>, _>>()?;
    let Some(mid) = timeline::timeline_mid_year(layout, &years) else {
        return Ok(JsValue::NULL);
    };
    Ok(
        Closure::<dyn Fn(JsValue) -> JsValue>::new(move |node: JsValue| {
            let year = year_of(&node).map(|year| year.unchecked_into_f64());
            timeline_lane_offset_js(mid, year)
        })
        .into_js_value(),
    )
}

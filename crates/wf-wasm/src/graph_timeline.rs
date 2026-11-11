//! Timeline layout lanes (wf-core `relations::graph_timeline`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_timeline as timeline;

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

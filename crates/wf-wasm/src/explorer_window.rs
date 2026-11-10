//! Which explorer rows are painted (wf-core `editor_workspace::explorer_window`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::editor_workspace::explorer_window as window;

use super::to_js;

/// [`row_slots`](window::row_slots). `viewport` is `null` before measuring,
/// `pinned` is an array of row indices, `metrics` the TS row constants.
///
/// # Errors
///
/// Fails if an argument does not have the expected shape, or the result cannot be serialised.
#[wasm_bindgen(js_name = rowSlots, unchecked_return_type = "B.RowSlot[]")]
pub fn row_slots_js(
    count: f64,
    #[wasm_bindgen(unchecked_param_type = "B.ExplorerViewport | null")] viewport: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] pinned: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.RowMetrics")] metrics: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let viewport: Option<window::ExplorerViewport> = serde_wasm_bindgen::from_value(viewport)?;
    let pinned: Vec<f64> = serde_wasm_bindgen::from_value(pinned)?;
    let metrics: window::RowMetrics = serde_wasm_bindgen::from_value(metrics)?;
    to_js(&window::row_slots(count, viewport, &pinned, metrics))
}

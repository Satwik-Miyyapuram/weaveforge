//! Settings rail group label and hint for JavaScript (wf-core `rail_group_text`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::rail_group_text::{self, RailGroupWords};

use super::to_js;

/// [`rail_group_text`](rail_group_text::rail_group_text). `group` is a `RailGroupWords`,
/// `visible` and `integrationTitles` are string arrays.
///
/// # Errors
///
/// Fails if an input cannot be read as the expected shape.
#[wasm_bindgen(js_name = railGroupText)]
pub fn rail_group_text_js(
    group: JsValue,
    visible: JsValue,
    integration_titles: JsValue,
) -> Result<JsValue, JsError> {
    let group: RailGroupWords =
        serde_wasm_bindgen::from_value(group).map_err(|e| JsError::new(&e.to_string()))?;
    let visible: Vec<String> =
        serde_wasm_bindgen::from_value(visible).map_err(|e| JsError::new(&e.to_string()))?;
    let titles: Vec<String> = serde_wasm_bindgen::from_value(integration_titles)
        .map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&rail_group_text::rail_group_text(&group, &visible, &titles))
        .map_err(|e| JsError::new(&e.to_string()))
}

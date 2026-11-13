//! Plan desktop widget for JavaScript (wf-core `plan_widget`). JS names are the
//! public `@weaveforge/wasm` names.

use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::plan_widget::{
    WidgetBounds, WorkArea, clean_widget_palette, parse_bounds, parse_taskbar_created, place_widget,
};

use super::to_js;

/// [`clean_widget_palette`]: the palette if every key is valid, else `null`.
///
/// # Errors
///
/// Fails if `value` cannot be read as JSON, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = cleanWidgetPalette, unchecked_return_type = "Record<string, string> | null")]
pub fn clean_widget_palette_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] value: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let value: Value = serde_wasm_bindgen::from_value(value)?;
    to_js(&clean_widget_palette(&value))
}

/// [`parse_bounds`]: the saved position from the preference JSON, or `null`. A non-string reads
/// as `null`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = parsePlanWidgetBounds, unchecked_return_type = "B.PlanWidgetBounds | null")]
pub fn parse_plan_widget_bounds_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] stored: &JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    match stored.as_string() {
        Some(stored) => to_js(&parse_bounds(&stored)),
        None => Ok(JsValue::NULL),
    }
}

/// [`place_widget`]: the saved spot if it is on a screen, else the top-right of the first one.
///
/// # Errors
///
/// Fails if `saved` is not a position or `areas` is not a list of work areas, or the result
/// cannot be converted to JS.
#[wasm_bindgen(js_name = placePlanWidget, unchecked_return_type = "B.PlanWidgetBounds")]
pub fn place_plan_widget_js(
    #[wasm_bindgen(unchecked_param_type = "B.PlanWidgetBounds | null")] saved: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.PlanWidgetWorkArea[]")] areas: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let saved: Option<WidgetBounds> = serde_wasm_bindgen::from_value(saved)?;
    let areas: Vec<WorkArea> = serde_wasm_bindgen::from_value(areas)?;
    to_js(&place_widget(saved, &areas))
}

/// [`parse_taskbar_created`]: the `TaskbarCreated` message id the helper printed, or `null`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = parseTaskbarCreatedId, unchecked_return_type = "number | null")]
pub fn parse_taskbar_created_id_js(stdout: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&parse_taskbar_created(stdout))
}

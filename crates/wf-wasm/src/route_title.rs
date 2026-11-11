//! wasm exports for `route_title` (TS: `route-title.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::route_title::{self, NavRoute};

/// [`route_title::title_for_path`]. `navItems` is an array of `{ path, label }`.
///
/// # Errors
///
/// Fails if `nav_items` is not an array of `{ path, label }` objects.
#[wasm_bindgen(js_name = titleForPath)]
pub fn title_for_path_js(
    pathname: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.NavRouteInput[]")] nav_items: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let items: Vec<NavRoute> = serde_wasm_bindgen::from_value(nav_items)?;
    Ok(route_title::title_for_path(pathname, &items))
}

/// [`route_title::label_for_path`]: the screen's own name, or `null` for a route with none.
///
/// # Errors
///
/// Fails if `nav_items` is not an array of `{ path, label }` objects.
#[wasm_bindgen(
    js_name = labelForPath,
    unchecked_return_type = "string | null"
)]
pub fn label_for_path_js(
    pathname: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.NavRouteInput[]")] nav_items: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let items: Vec<NavRoute> = serde_wasm_bindgen::from_value(nav_items)?;
    let label = route_title::label_for_path(pathname, &items);
    Ok(label.map_or(JsValue::NULL, JsValue::from))
}

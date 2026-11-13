//! wasm exports for `nav_open_groups`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::nav_open_groups;

use super::to_js;

/// [`nav_open_groups::with_active`]: `groups` with `active` appended when it is not already listed.
///
/// # Errors
///
/// Fails if `groups` is not an array of strings, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = withActive, unchecked_return_type = "string[]")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn with_active_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] groups: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "string | null")] active: Option<String>,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let groups: Vec<String> = serde_wasm_bindgen::from_value(groups)?;
    to_js(&nav_open_groups::with_active(&groups, active.as_deref()))
}

/// [`nav_open_groups::toggle_group`]: `groups` with `key` added when closed, removed when open.
///
/// # Errors
///
/// Fails if `groups` is not an array of strings, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = toggleGroup, unchecked_return_type = "string[]")]
pub fn toggle_group_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] groups: JsValue,
    key: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let groups: Vec<String> = serde_wasm_bindgen::from_value(groups)?;
    to_js(&nav_open_groups::toggle_group(&groups, key))
}

/// [`nav_open_groups::load_open_groups`]: the open groups from stored JSON, with `active` forced open.
///
/// # Errors
///
/// Fails if the result cannot be converted to JS.
#[wasm_bindgen(js_name = loadOpenGroups, unchecked_return_type = "string[]")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn load_open_groups_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null")] raw: Option<String>,
    #[wasm_bindgen(unchecked_optional_param_type = "string | null")] active: Option<String>,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&nav_open_groups::load_open_groups(
        raw.as_deref(),
        active.as_deref(),
    ))
}

/// [`nav_open_groups::encode_open_groups`]: the stored JSON for an open-groups list.
///
/// # Errors
///
/// Fails if `groups` is not an array of strings.
#[wasm_bindgen(js_name = encodeOpenGroups)]
pub fn encode_open_groups_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] groups: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let groups: Vec<String> = serde_wasm_bindgen::from_value(groups)?;
    Ok(nav_open_groups::encode_open_groups(&groups))
}

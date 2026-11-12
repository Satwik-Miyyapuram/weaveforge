//! Appearance preferences for JavaScript (wf-core `settings::user_appearance`). JS names
//! match `packages/core/src/features/settings/domain/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::settings::user_appearance;

use super::theme_config::plain_json;
use super::to_js;

/// [`normalize_appearance`](user_appearance::normalize_appearance) of `raw` read as plain JSON
/// (as the stored row is); `undefined` when nothing is valid.
///
/// # Errors
///
/// Fails if `raw` cannot be rebuilt as JSON.
#[wasm_bindgen(
    js_name = normalizeAppearance,
    unchecked_return_type = "B.UserAppearance | undefined"
)]
pub fn normalize_appearance_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: &JsValue,
) -> Result<JsValue, JsValue> {
    let raw = if raw.is_undefined() {
        serde_json::Value::Null
    } else {
        plain_json(raw)?
    };
    match user_appearance::normalize_appearance(&raw) {
        Some(out) => Ok(to_js(&out)?),
        None => Ok(JsValue::UNDEFINED),
    }
}

/// [`merge_server_appearance`](user_appearance::merge_server_appearance) of `server` over
/// `local`, both read as plain JSON. Always an object.
///
/// # Errors
///
/// Fails if either side cannot be rebuilt as JSON or the result cannot be converted.
#[wasm_bindgen(js_name = mergeServerAppearance, unchecked_return_type = "B.UserAppearance")]
pub fn merge_server_appearance_js(
    #[wasm_bindgen(unchecked_param_type = "B.UserAppearance")] local: &JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.UserAppearance")] server: &JsValue,
) -> Result<JsValue, JsValue> {
    let merged = user_appearance::merge_server_appearance(&plain_json(local)?, &plain_json(server)?);
    Ok(to_js(&merged)?)
}

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

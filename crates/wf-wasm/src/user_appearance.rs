//! Appearance preferences for JavaScript (wf-core `settings::user_appearance`). JS names
//! match `packages/core/src/features/settings/domain/user-appearance.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::settings::user_appearance;

use super::to_js;

fn read(raw: JsValue) -> Result<serde_json::Value, serde_wasm_bindgen::Error> {
    if raw.is_undefined() {
        Ok(serde_json::Value::Null)
    } else {
        serde_wasm_bindgen::from_value(raw)
    }
}

/// [`normalize_appearance`](user_appearance::normalize_appearance); `undefined` when
/// nothing is valid.
///
/// # Errors
///
/// Fails if `raw` cannot be read as JSON.
#[wasm_bindgen(js_name = normalizeAppearance)]
pub fn normalize_appearance_js(raw: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    match user_appearance::normalize_appearance(&read(raw)?) {
        Some(out) => to_js(&out),
        None => Ok(JsValue::UNDEFINED),
    }
}

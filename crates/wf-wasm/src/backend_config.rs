//! wasm export for `backend_config` (TS: `backend-config.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::backend_config::{BackendConfigFields, ConfigField, missing_config_message};

use super::to_js;

/// [`missing_config_message`]: names the absent required env vars, never values.
/// `cfg` is the backend config object; `required` is an array of camelCase field names.
///
/// # Errors
///
/// Fails if `cfg` is not an object of optional strings, `required` is not an array of
/// known field names, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = missingConfigMessage)]
pub fn missing_config_message_js(
    cfg: JsValue,
    required: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let cfg: BackendConfigFields = serde_wasm_bindgen::from_value(cfg)?;
    let required: Vec<ConfigField> = serde_wasm_bindgen::from_value(required)?;
    to_js(&missing_config_message(&cfg, &required))
}

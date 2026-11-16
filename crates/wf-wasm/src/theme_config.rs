//! Theme config parsing for JavaScript (wf-core `settings::theme_config`). JS names match
//! `packages/core/src/features/settings/domain/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::settings::theme_config;

use super::to_js;

/// `raw` as plain JSON, the way `JSON.parse(JSON.stringify(raw) ?? "null")` rebuilds it:
/// functions and `undefined` fields drop out, dates become strings.
///
/// # Errors
///
/// Fails if `raw` cannot be stringified (a cycle or a `BigInt`) or read back as JSON.
pub(crate) fn plain_json(raw: &JsValue) -> Result<serde_json::Value, JsValue> {
    let text = js_sys::JSON::stringify(raw)?
        .as_string()
        .unwrap_or_else(|| "null".to_owned());
    let parsed = js_sys::JSON::parse(&text)?;
    Ok(serde_wasm_bindgen::from_value(parsed)?)
}

/// [`parse_theme_config`](theme_config::parse_theme_config); a non-string reads as empty.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = parseThemeConfig, unchecked_return_type = "B.ThemeConfigParseResult")]
pub fn parse_theme_config_js(
    #[wasm_bindgen(unchecked_param_type = "string")] text: &JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let text = text.as_string().unwrap_or_default();
    to_js(&theme_config::parse_theme_config(&text))
}

/// [`normalize_theme_config`](theme_config::normalize_theme_config): a stored config
/// re-checked as if uploaded again (as plain JSON), `null` when it no longer passes.
///
/// # Errors
///
/// Fails if `raw` cannot be rebuilt as JSON.
#[wasm_bindgen(js_name = normalizeThemeConfig, unchecked_return_type = "B.ThemeConfig | null")]
pub fn normalize_theme_config_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: &JsValue,
) -> Result<JsValue, JsValue> {
    let raw = plain_json(raw)?;
    Ok(to_js(&theme_config::normalize_theme_config(&raw))?)
}

/// [`theme_config_template`](theme_config::theme_config_template): the starter file.
#[must_use]
#[wasm_bindgen(js_name = themeConfigTemplate)]
pub fn theme_config_template_js() -> String {
    theme_config::theme_config_template()
}

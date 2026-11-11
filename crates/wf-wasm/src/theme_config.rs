//! Theme config parsing for JavaScript (wf-core `settings::theme_config`). JS names match
//! `packages/core/src/features/settings/domain/theme-config.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::settings::theme_config;

use super::to_js;

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

/// [`normalize_color_value`](theme_config::normalize_color_value); `null` for a
/// non-string or a rejected color.
#[must_use]
#[wasm_bindgen(js_name = normalizeColorValue, unchecked_return_type = "string | null")]
pub fn normalize_color_value_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: &JsValue,
) -> JsValue {
    let value = raw
        .as_string()
        .and_then(|raw| theme_config::normalize_color_value(&raw));
    value.map_or(JsValue::NULL, JsValue::from)
}

/// [`normalize_font_stack`](theme_config::normalize_font_stack); `null` for a
/// non-string or a rejected stack.
#[must_use]
#[wasm_bindgen(js_name = normalizeFontStack, unchecked_return_type = "string | null")]
pub fn normalize_font_stack_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: &JsValue,
) -> JsValue {
    let value = raw
        .as_string()
        .and_then(|raw| theme_config::normalize_font_stack(&raw));
    value.map_or(JsValue::NULL, JsValue::from)
}

/// A length from a number (px) or a string, limited to `max_px` (default 64).
#[must_use]
#[wasm_bindgen(js_name = normalizeLengthValue)]
pub fn normalize_length_value_js(raw: &JsValue, max_px: Option<f64>) -> Option<String> {
    let max_px = max_px.unwrap_or(64.0);
    if let Some(number) = raw.as_f64() {
        return theme_config::normalize_length_number(number, max_px);
    }
    raw.as_string()
        .and_then(|raw| theme_config::normalize_length_text(&raw, max_px))
}

/// [`normalize_theme_config`](theme_config::normalize_theme_config): a stored config
/// re-checked, `null` when it no longer passes.
///
/// # Errors
///
/// Fails if `raw` cannot be read as JSON.
#[wasm_bindgen(js_name = normalizeThemeConfig)]
pub fn normalize_theme_config_js(raw: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let raw = if raw.is_undefined() {
        serde_json::Value::Null
    } else {
        serde_wasm_bindgen::from_value(raw)?
    };
    to_js(&theme_config::normalize_theme_config(&raw))
}

/// [`theme_config_template`](theme_config::theme_config_template): the starter file.
#[must_use]
#[wasm_bindgen(js_name = themeConfigTemplate)]
pub fn theme_config_template_js() -> String {
    theme_config::theme_config_template()
}

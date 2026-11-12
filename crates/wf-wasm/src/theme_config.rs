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

/// A length such as `12px`, `0.5rem` or a px number, limited to `max_px` (default 64); `null`
/// otherwise.
#[must_use]
#[wasm_bindgen(js_name = normalizeLengthValue, unchecked_return_type = "string | null")]
pub fn normalize_length_value_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: &JsValue,
    #[wasm_bindgen(js_name = maxPx)] max_px: Option<f64>,
) -> JsValue {
    let max_px = max_px.unwrap_or(64.0);
    let value = match raw.as_f64() {
        Some(number) => theme_config::normalize_length_number(number, max_px),
        None => raw
            .as_string()
            .and_then(|raw| theme_config::normalize_length_text(&raw, max_px)),
    };
    value.map_or(JsValue::NULL, JsValue::from)
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

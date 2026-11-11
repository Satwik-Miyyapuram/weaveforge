//! Search settings helpers for JavaScript (wf-core `search_settings`). The JS names
//! match `packages/core/src/search/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::query::SearchKind;
use wf_core::search::search_settings::{self, FieldBoosts, SearchSettings};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Any JS value as JSON. `undefined`, functions and symbols read as `null`.
fn json_from(raw: JsValue) -> JsResult<serde_json::Value> {
    if raw.is_undefined() {
        return Ok(serde_json::Value::Null);
    }
    serde_wasm_bindgen::from_value(raw)
}

/// Settings from a JS value, normalized as TS did on the way in; `None` for absent or invalid.
///
/// # Errors
///
/// Fails if `raw` cannot be read as JSON.
fn settings_from(raw: JsValue) -> JsResult<Option<SearchSettings>> {
    let value = json_from(raw)?;
    Ok(search_settings::normalize_search_settings(&value))
}

/// [`normalize_search_settings`](search_settings::normalize_search_settings); `undefined` when nothing valid remains.
///
/// # Errors
///
/// Fails if `raw` cannot be read as JSON.
#[wasm_bindgen(js_name = normalizeSearchSettings, unchecked_return_type = "B.SearchSettings | undefined")]
pub fn normalize_search_settings_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: JsValue,
) -> JsResult<JsValue> {
    match settings_from(raw)? {
        Some(settings) => to_js(&settings),
        None => Ok(JsValue::UNDEFINED),
    }
}

/// [`effective_field_boosts`](search_settings::effective_field_boosts).
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(js_name = effectiveFieldBoosts, unchecked_return_type = "B.FieldBoosts")]
pub fn effective_field_boosts_js(
    #[wasm_bindgen(unchecked_param_type = "B.SearchSettings")] settings: Option<JsValue>,
) -> JsResult<JsValue> {
    let settings = settings_from(settings.unwrap_or(JsValue::UNDEFINED))?;
    let boosts: FieldBoosts = search_settings::effective_field_boosts(settings.as_ref());
    to_js(&boosts)
}

/// [`kind_multiplier`](search_settings::kind_multiplier); an unknown `kind` reads as `1`.
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(js_name = kindMultiplier)]
pub fn kind_multiplier_js(
    #[wasm_bindgen(unchecked_param_type = "B.SearchKind")] kind: &str,
    #[wasm_bindgen(unchecked_param_type = "B.SearchSettings")] settings: Option<JsValue>,
) -> JsResult<f64> {
    let settings = settings_from(settings.unwrap_or(JsValue::UNDEFINED))?;
    Ok(SearchKind::parse(kind).map_or(1.0, |kind| {
        search_settings::kind_multiplier(kind, settings.as_ref())
    }))
}

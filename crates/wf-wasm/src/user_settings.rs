//! User settings row helpers for JavaScript (wf-core `settings::user_settings`). The JS names
//! match `packages/core/src/features/settings/domain/parts.ts`.

use js_sys::JSON;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::settings::integration_credentials::IntegrationCredentialBag;
use wf_core::settings::user_settings;

use super::to_js;

/// Any JS value as plain JSON, as `JSON.parse(JSON.stringify(raw) ?? "null")` reads it: non-JSON
/// fields drop, and `undefined` reads as `null`.
///
/// # Errors
///
/// Fails if `JSON.stringify` throws (a cycle or a `BigInt`).
pub(crate) fn read(raw: &JsValue) -> Result<serde_json::Value, JsValue> {
    let Some(text) = JSON::stringify(raw)?.as_string() else {
        return Ok(serde_json::Value::Null);
    };
    serde_json::from_str(&text).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// [`hydrate_user_settings`](user_settings::hydrate_user_settings): merge the integrations bag
/// from the legacy columns when loading from persistence.
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(js_name = hydrateUserSettings, unchecked_return_type = "B.UserSettings")]
pub fn hydrate_user_settings_js(
    #[wasm_bindgen(unchecked_param_type = "B.UserSettings")] settings: JsValue,
) -> Result<JsValue, JsValue> {
    Ok(to_js(&user_settings::hydrate_user_settings(&read(
        &settings,
    )?))?)
}

/// [`normalize_user_settings`](user_settings::normalize_user_settings): trim strings and drop
/// empties before persistence.
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(js_name = normalizeUserSettings, unchecked_return_type = "B.UserSettings")]
pub fn normalize_user_settings_js(
    #[wasm_bindgen(unchecked_param_type = "B.UserSettings")] settings: JsValue,
) -> Result<JsValue, JsValue> {
    Ok(to_js(&user_settings::normalize_user_settings(&read(
        &settings,
    )?))?)
}

/// [`apply_user_integration_fields`](user_settings::apply_user_integration_fields): set a
/// provider's credential fields in its bag and the matching legacy columns.
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON or `fields` is not a string map.
#[wasm_bindgen(js_name = applyUserIntegrationFields, unchecked_return_type = "B.UserSettings")]
pub fn apply_user_integration_fields_js(
    #[wasm_bindgen(unchecked_param_type = "B.UserSettings")] settings: JsValue,
    provider_id: &str,
    #[wasm_bindgen(unchecked_param_type = "Record<string, string>")] fields: JsValue,
) -> Result<JsValue, JsValue> {
    let fields: IntegrationCredentialBag = serde_json::from_value(read(&fields)?)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(to_js(&user_settings::apply_user_integration_fields(
        &read(&settings)?,
        provider_id,
        &fields,
    ))?)
}

/// [`needs_disclaimer_acceptance`](user_settings::needs_disclaimer_acceptance): whether the user
/// must accept the disclaimer again (no acceptance, or an older version).
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(js_name = needsDisclaimerAcceptance)]
pub fn needs_disclaimer_acceptance_js(
    #[wasm_bindgen(
        unchecked_param_type = "Pick<B.UserSettings, \"disclaimerAcceptedAt\" | \"disclaimerVersion\">"
    )]
    settings: JsValue,
) -> Result<bool, JsValue> {
    Ok(user_settings::needs_disclaimer_acceptance(&read(
        &settings,
    )?))
}

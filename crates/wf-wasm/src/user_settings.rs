//! User settings row helpers for JavaScript (wf-core `settings::user_settings`). The JS names
//! match `packages/core/src/features/settings/domain/user-settings.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::settings::integration_credentials::IntegrationCredentialBag;
use wf_core::settings::user_settings;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Any JS value as JSON; `undefined` reads as `null`.
fn read(raw: JsValue) -> JsResult<serde_json::Value> {
    if raw.is_undefined() {
        return Ok(serde_json::Value::Null);
    }
    serde_wasm_bindgen::from_value(raw)
}

/// [`hydrate_user_settings`](user_settings::hydrate_user_settings).
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(js_name = hydrateUserSettings)]
pub fn hydrate_user_settings_js(settings: JsValue) -> JsResult<JsValue> {
    to_js(&user_settings::hydrate_user_settings(&read(settings)?))
}

/// [`normalize_user_settings`](user_settings::normalize_user_settings).
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(js_name = normalizeUserSettings)]
pub fn normalize_user_settings_js(settings: JsValue) -> JsResult<JsValue> {
    to_js(&user_settings::normalize_user_settings(&read(settings)?))
}

/// [`apply_user_integration_fields`](user_settings::apply_user_integration_fields).
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON or `fields` is not a string map.
#[wasm_bindgen(js_name = applyUserIntegrationFields)]
pub fn apply_user_integration_fields_js(
    settings: JsValue,
    provider_id: &str,
    fields: JsValue,
) -> JsResult<JsValue> {
    let fields: IntegrationCredentialBag = serde_wasm_bindgen::from_value(fields)?;
    to_js(&user_settings::apply_user_integration_fields(
        &read(settings)?,
        provider_id,
        &fields,
    ))
}

/// [`needs_disclaimer_acceptance`](user_settings::needs_disclaimer_acceptance).
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(js_name = needsDisclaimerAcceptance)]
pub fn needs_disclaimer_acceptance_js(settings: JsValue) -> JsResult<bool> {
    Ok(user_settings::needs_disclaimer_acceptance(&read(settings)?))
}

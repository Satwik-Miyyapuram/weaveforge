//! Provider credential helpers for JavaScript (wf-core `settings::integration_credentials`). The JS
//! names match `packages/core/src/features/settings/domain/user-integration-credentials.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::settings::integration_credentials::{self, CredentialSettings};

use serde_json::Value;

use super::to_js;
use super::user_settings::read as plain_json;

/// Settings read the way the TypeScript reads them: `settings.integrations?.[p]?.[f]?.trim()`
/// skips a provider that is not an object and a field that is null, and ignores legacy columns
/// that are not strings. A requested field (`read`) holding any other non-string throws in TS
/// (`.trim` is not a function), so it fails here too. Everything else that is not a string is
/// dropped, since TS never reads it. `raw` is the settings after a JSON round trip.
fn credential_settings(
    raw: &Value,
    read: Option<(&str, &str)>,
) -> Result<CredentialSettings, serde_wasm_bindgen::Error> {
    let Value::Object(raw) = raw else {
        return Ok(CredentialSettings::default());
    };
    let text = |key: &str| match raw.get(key) {
        Some(Value::String(value)) => Some(value.clone()),
        _ => None,
    };
    let integrations = match raw.get("integrations") {
        Some(Value::Object(providers)) => Some(
            providers
                .iter()
                .filter_map(|(provider, fields)| match fields {
                    Value::Object(fields) => Some((provider, fields)),
                    _ => None,
                })
                .map(|(provider, fields)| {
                    let bag = fields
                        .iter()
                        .filter_map(|(field, value)| match value {
                            Value::String(value) => Some(Ok((field.clone(), value.clone()))),
                            Value::Null => None,
                            _ if read == Some((provider.as_str(), field.as_str())) => {
                                Some(Err(serde_wasm_bindgen::Error::new(format!(
                                    "integrations.{provider}.{field} is not a string"
                                ))))
                            }
                            _ => None,
                        })
                        .collect::<Result<_, _>>()?;
                    Ok((provider.clone(), bag))
                })
                .collect::<Result<_, serde_wasm_bindgen::Error>>()?,
        ),
        _ => None,
    };
    Ok(CredentialSettings {
        integrations,
        zotero_api_key: text("zoteroApiKey"),
        zotero_library: text("zoteroLibrary"),
        semantic_scholar_key: text("semanticScholarKey"),
    })
}

fn field(
    settings: &Value,
    provider_id: &str,
    field_id: &str,
) -> Result<Option<String>, serde_wasm_bindgen::Error> {
    let settings = credential_settings(settings, Some((provider_id, field_id)))?;
    Ok(integration_credentials::get_user_integration_field(
        &settings,
        provider_id,
        field_id,
    ))
}

/// [`get_user_integration_field`](integration_credentials::get_user_integration_field): a
/// provider field from the integrations bag or the legacy flat columns; `undefined` when empty.
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON or the requested field is not a string.
#[wasm_bindgen(js_name = getUserIntegrationField)]
pub fn get_user_integration_field_js(
    #[wasm_bindgen(unchecked_param_type = "B.CredentialSettings")] settings: JsValue,
    provider_id: &str,
    field_id: &str,
) -> Result<Option<String>, JsValue> {
    Ok(field(&plain_json(&settings)?, provider_id, field_id)?)
}

/// [`is_user_integration_connected`](integration_credentials::is_user_integration_connected).
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON, `field_ids` is not a string array, or a field
/// checked before the first set one is not a string.
#[wasm_bindgen(js_name = isUserIntegrationConnected)]
pub fn is_user_integration_connected_js(
    #[wasm_bindgen(unchecked_param_type = "B.CredentialSettings")] settings: &JsValue,
    provider_id: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] field_ids: JsValue,
) -> Result<bool, JsValue> {
    let settings = plain_json(settings)?;
    let field_ids: Vec<String> = serde_wasm_bindgen::from_value(field_ids)?;
    // Field by field, stopping at the first set one, as TS `some` does.
    for field_id in &field_ids {
        if field(&settings, provider_id, field_id)?.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// [`integrations_bag_from_legacy`](integration_credentials::integrations_bag_from_legacy);
/// `undefined` when no legacy field is set.
///
/// # Errors
///
/// Fails if `settings` cannot be read as JSON.
#[wasm_bindgen(
    js_name = integrationsBagFromLegacy,
    unchecked_return_type = "Record<string, Record<string, string>> | undefined"
)]
pub fn integrations_bag_from_legacy_js(
    #[wasm_bindgen(unchecked_param_type = "B.CredentialSettings")] settings: JsValue,
) -> Result<JsValue, JsValue> {
    let settings = credential_settings(&plain_json(&settings)?, None)?;
    match integration_credentials::integrations_bag_from_legacy(&settings) {
        Some(bag) => Ok(to_js(&bag)?),
        None => Ok(JsValue::UNDEFINED),
    }
}

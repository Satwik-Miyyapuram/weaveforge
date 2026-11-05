//! Provider credential helpers for JavaScript (wf-core `settings::integration_credentials`). The JS
//! names match `packages/core/src/features/settings/domain/user-integration-credentials.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::settings::integration_credentials::{self, CredentialSettings};

use serde_json::Value;

use super::to_js;

/// Settings read the way the TypeScript reads them: `settings.integrations?.[p]?.[f]?.trim()`
/// skips a provider that is not an object and a field that is null, and ignores legacy columns
/// that are not strings. A requested field (`read`) holding any other non-string throws in TS
/// (`.trim` is not a function), so it fails here too. Everything else that is not a string is
/// dropped, since TS never reads it.
fn credential_settings(
    raw: JsValue,
    read: Option<(&str, &str)>,
) -> Result<CredentialSettings, serde_wasm_bindgen::Error> {
    let raw: Value = if raw.is_undefined() || raw.is_null() {
        Value::Null
    } else {
        serde_wasm_bindgen::from_value(raw)?
    };
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
    settings: JsValue,
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

/// [`get_user_integration_field`](integration_credentials::get_user_integration_field);
/// `undefined` when empty.
///
/// # Errors
///
/// Fails if `settings` has the wrong shape.
#[wasm_bindgen(js_name = getUserIntegrationField)]
pub fn get_user_integration_field_js(
    settings: JsValue,
    provider_id: &str,
    field_id: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    match field(settings, provider_id, field_id)? {
        Some(value) => to_js(&value),
        None => Ok(JsValue::UNDEFINED),
    }
}

/// [`is_user_integration_connected`](integration_credentials::is_user_integration_connected).
///
/// # Errors
///
/// Fails if `settings` or `field_ids` has the wrong shape.
#[wasm_bindgen(js_name = isUserIntegrationConnected)]
pub fn is_user_integration_connected_js(
    settings: &JsValue,
    provider_id: &str,
    field_ids: JsValue,
) -> Result<bool, serde_wasm_bindgen::Error> {
    let field_ids: Vec<String> = serde_wasm_bindgen::from_value(field_ids)?;
    // Field by field, stopping at the first set one, as TS `some` does.
    for field_id in &field_ids {
        if field(settings.clone(), provider_id, field_id)?.is_some() {
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
/// Fails if `settings` has the wrong shape.
#[wasm_bindgen(js_name = integrationsBagFromLegacy)]
pub fn integrations_bag_from_legacy_js(
    settings: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let settings = credential_settings(settings, None)?;
    match integration_credentials::integrations_bag_from_legacy(&settings) {
        Some(bag) => to_js(&bag),
        None => Ok(JsValue::UNDEFINED),
    }
}

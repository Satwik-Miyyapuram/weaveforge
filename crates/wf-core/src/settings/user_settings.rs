//! The per-user settings row: fill the integrations bag from legacy columns, clean it before
//! saving, and set provider fields. Port of
//! `packages/core/src/features/settings/domain/user-settings.ts` and `applyUserIntegrationFields`
//! from `user-integration-credentials.ts`. Pure.
//!
//! The functions work on the JSON row, so keys they do not know survive as the TS spreads keep
//! them.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Map, Value};

use super::integration_credentials::{
    CredentialSettings, IntegrationCredentialBag, integrations_bag_from_legacy,
};
use super::user_appearance::{UserAppearance, normalize_appearance};
use crate::ai::access_policy::{
    AiAccessSettings, AiAccessSettingsInput, normalize_ai_access_settings,
};
use crate::reader_analysis::lines::js_trim;
use crate::search::search_settings::{SearchSettings, normalize_search_settings};

/// The settings row (TS `UserSettings`), for the generated bindings.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct UserSettings {
    /// Provider-keyed credential bags; legacy flat columns stay in sync.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub integrations: Option<BTreeMap<String, IntegrationCredentialBag>>,
    /// Zotero Web API key.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub zotero_api_key: Option<String>,
    /// Zotero library path, e.g. `users/123456`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub zotero_library: Option<String>,
    /// Semantic Scholar API key.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub semantic_scholar_key: Option<String>,
    /// When the user accepted the disclaimer, ISO 8601.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub disclaimer_accepted_at: Option<String>,
    /// Version of the accepted disclaimer.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub disclaimer_version: Option<u32>,
    /// Theme and control preferences.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub appearance: Option<UserAppearance>,
    /// Fail-closed AI assistant access.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub ai_access: Option<AiAccessSettings>,
    /// Workspace search ranking.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub search: Option<SearchSettings>,
}

/// The legacy flat credential columns.
const LEGACY_COLUMNS: [&str; 3] = ["zoteroApiKey", "zoteroLibrary", "semanticScholarKey"];

/// Legacy column a provider field is mirrored to (TS `LEGACY_FIELD_MAP`).
fn legacy_column(provider_id: &str, field_id: &str) -> Option<&'static str> {
    match (provider_id, field_id) {
        ("zotero", "apiKey") => Some("zoteroApiKey"),
        ("zotero", "library") => Some("zoteroLibrary"),
        ("semantic-scholar", "apiKey") => Some("semanticScholarKey"),
        _ => None,
    }
}

/// JS truthiness of a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n.abs() > 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// The legacy columns that hold strings, as the credential helpers read them.
fn legacy_columns(row: &Map<String, Value>) -> CredentialSettings {
    let text = |key: &str| row.get(key).and_then(Value::as_str).map(str::to_owned);
    CredentialSettings {
        integrations: None,
        zotero_api_key: text("zoteroApiKey"),
        zotero_library: text("zoteroLibrary"),
        semantic_scholar_key: text("semanticScholarKey"),
    }
}

/// TS `settings.integrations ?? integrationsBagFromLegacy(settings)`.
fn integrations_or_legacy(row: &Map<String, Value>) -> Option<Value> {
    match row.get("integrations") {
        Some(bags) if !bags.is_null() => Some(bags.clone()),
        _ => integrations_bag_from_legacy(&legacy_columns(row))
            .and_then(|bag| serde_json::to_value(bag).ok()),
    }
}

/// Insert `value` as JSON under `key`.
fn put<T: Serialize>(out: &mut Map<String, Value>, key: &str, value: &T) {
    if let Ok(json) = serde_json::to_value(value) {
        let _ = out.insert(key.to_owned(), json);
    }
}

/// Untrusted AI access settings as the TS normalizer reads them: wrong types read as absent.
fn ai_access_input(raw: &Value) -> AiAccessSettingsInput {
    let names = |key: &str| {
        raw.get(key).and_then(Value::as_array).map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
    };
    AiAccessSettingsInput {
        enabled: raw.get("enabled").and_then(Value::as_bool),
        disclosure_accepted_at: raw
            .get("disclosureAcceptedAt")
            .and_then(Value::as_str)
            .map(str::to_owned),
        read_categories: names("readCategories"),
        proposal_kinds: names("proposalKinds"),
        auto_include_new_source_categories: names("autoIncludeNewSourceCategories"),
    }
}

/// Provider bags with fields trimmed and blank fields and empty bags dropped; `None` when
/// nothing is left.
fn clean_integrations(raw: &Value) -> Option<Value> {
    let mut cleaned = Map::new();
    for (provider_id, bag) in raw.as_object()? {
        let fields: Map<String, Value> = bag
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(field_id, value)| {
                let trimmed = js_trim(value.as_str()?);
                (!trimmed.is_empty()).then(|| (field_id.clone(), Value::String(trimmed.to_owned())))
            })
            .collect();
        if !fields.is_empty() {
            let _ = cleaned.insert(provider_id.clone(), Value::Object(fields));
        }
    }
    (!cleaned.is_empty()).then_some(Value::Object(cleaned))
}

/// Merge the integrations bag from legacy columns when loading a row (TS `hydrateUserSettings`).
#[must_use]
pub fn hydrate_user_settings(settings: &Value) -> Value {
    let Value::Object(row) = settings else {
        return settings.clone();
    };
    let Some(integrations) = integrations_or_legacy(row) else {
        return settings.clone();
    };
    let mut out = row.clone();
    let _ = out.insert("integrations".to_owned(), integrations);
    Value::Object(out)
}

/// Trim strings and drop empties before saving (TS `normalizeUserSettings`). Only known keys
/// survive.
#[must_use]
pub fn normalize_user_settings(settings: &Value) -> Value {
    let empty = Map::new();
    let row = settings.as_object().unwrap_or(&empty);
    let field = |key: &str| row.get(key).unwrap_or(&Value::Null);
    let mut out = Map::new();
    for key in LEGACY_COLUMNS {
        let text = field(key).as_str().map(js_trim).filter(|t| !t.is_empty());
        if let Some(text) = text {
            let _ = out.insert(key.to_owned(), Value::String(text.to_owned()));
        }
    }
    if truthy(field("disclaimerAcceptedAt")) {
        put(
            &mut out,
            "disclaimerAcceptedAt",
            field("disclaimerAcceptedAt"),
        );
    }
    let version = field("disclaimerVersion").as_f64();
    if version.is_some_and(|v| v.is_finite() && v.fract() == 0.0 && v > 0.0) {
        put(&mut out, "disclaimerVersion", field("disclaimerVersion"));
    }
    if let Some(appearance) = normalize_appearance(field("appearance")) {
        put(&mut out, "appearance", &appearance);
    }
    if truthy(field("aiAccess")) {
        let input = ai_access_input(field("aiAccess"));
        put(
            &mut out,
            "aiAccess",
            &normalize_ai_access_settings(Some(&input)),
        );
    }
    if let Some(search) = normalize_search_settings(field("search")) {
        put(&mut out, "search", &search);
    }
    if let Some(cleaned) = integrations_or_legacy(row)
        .as_ref()
        .and_then(clean_integrations)
    {
        let _ = out.insert("integrations".to_owned(), cleaned);
    }
    Value::Object(out)
}

/// Set a provider's credential fields in its bag and the matching legacy columns
/// (TS `applyUserIntegrationFields`).
#[must_use]
pub fn apply_user_integration_fields(
    settings: &Value,
    provider_id: &str,
    fields: &IntegrationCredentialBag,
) -> Value {
    let mut next = settings.as_object().cloned().unwrap_or_default();
    let mut bags = next
        .get("integrations")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut bag = bags
        .get(provider_id)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (field_id, value) in fields {
        let _ = bag.insert(field_id.clone(), Value::String(value.clone()));
        if let Some(column) = legacy_column(provider_id, field_id) {
            let _ = next.insert(column.to_owned(), Value::String(value.clone()));
        }
    }
    let _ = bags.insert(provider_id.to_owned(), Value::Object(bag));
    let _ = next.insert("integrations".to_owned(), Value::Object(bags));
    Value::Object(next)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn hydrate_fills_bag_from_legacy_and_keeps_other_keys() {
        let row = json!({ "zoteroApiKey": " k ", "extra": 1 });
        assert_eq!(
            hydrate_user_settings(&row),
            json!({ "zoteroApiKey": " k ", "extra": 1, "integrations": { "zotero": { "apiKey": "k" } } })
        );
        let row = json!({ "integrations": {}, "zoteroApiKey": "k" });
        assert_eq!(hydrate_user_settings(&row), row);
        assert_eq!(hydrate_user_settings(&json!({ "x": 1 })), json!({ "x": 1 }));
    }

    #[test]
    fn normalize_trims_and_drops_empties_and_unknown_keys() {
        let row = json!({
            "zoteroApiKey": "  ",
            "semanticScholarKey": " s ",
            "disclaimerAcceptedAt": "",
            "disclaimerVersion": 2,
            "extra": true,
            "integrations": { "zotero": { "apiKey": " ", "library": " users/1 " }, "x": { "a": "" } },
        });
        assert_eq!(
            normalize_user_settings(&row),
            json!({
                "semanticScholarKey": "s",
                "disclaimerVersion": 2,
                "integrations": { "zotero": { "library": "users/1" } },
            })
        );
    }

    #[test]
    fn normalize_rejects_bad_versions_and_defaults_ai_access() {
        for version in [json!(0), json!(1.5), json!(-1), json!("2")] {
            let out = normalize_user_settings(&json!({ "disclaimerVersion": version }));
            assert_eq!(out, json!({}));
        }
        let out = normalize_user_settings(&json!({ "aiAccess": { "enabled": "yes" } }));
        assert_eq!(out["aiAccess"]["enabled"], json!(false));
    }

    #[test]
    fn apply_sets_bag_and_legacy_column() {
        let row = json!({ "integrations": { "zotero": { "library": "users/1" } } });
        let fields = IntegrationCredentialBag::from([("apiKey".to_owned(), "k".to_owned())]);
        assert_eq!(
            apply_user_integration_fields(&row, "zotero", &fields),
            json!({
                "zoteroApiKey": "k",
                "integrations": { "zotero": { "library": "users/1", "apiKey": "k" } },
            })
        );
        let out = apply_user_integration_fields(&json!({}), "github", &fields);
        assert_eq!(
            out,
            json!({ "integrations": { "github": { "apiKey": "k" } } })
        );
    }
}

//! Provider credential helpers: read and derive per-provider fields from the integrations bag or
//! the legacy flat columns. Port of
//! `packages/core/src/features/settings/domain/user-integration-credentials.ts`. Pure.
//!
//! `applyUserIntegrationFields` lives in `user_settings`, as it returns the whole settings record.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::reader_analysis::lines::js_trim;

/// Field id to value for one provider (TS `IntegrationCredentialBag`).
pub type IntegrationCredentialBag = BTreeMap<String, String>;

/// The settings fields the credential helpers read (TS `UserSettings`, credential part).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CredentialSettings {
    /// Provider-keyed credential bags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub integrations: Option<BTreeMap<String, IntegrationCredentialBag>>,
    /// Zotero Web API key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub zotero_api_key: Option<String>,
    /// Zotero library path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub zotero_library: Option<String>,
    /// Semantic Scholar API key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub semantic_scholar_key: Option<String>,
}

/// The integrations bag built from legacy columns (TS `integrationsBagFromLegacy` output).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct IntegrationsBag {
    /// Zotero fields (`apiKey`, `library`), present when any is non-empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub zotero: Option<IntegrationCredentialBag>,
    /// Semantic Scholar fields (`apiKey`), present when non-empty.
    #[serde(
        rename = "semantic-scholar",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub semantic_scholar: Option<IntegrationCredentialBag>,
}

/// Legacy flat column a provider field maps to (TS `LEGACY_FIELD_MAP` values).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LegacyKey {
    ZoteroApiKey,
    ZoteroLibrary,
    SemanticScholarKey,
}

/// Legacy column for a provider field, if any (TS `LEGACY_FIELD_MAP`).
fn legacy_key(provider_id: &str, field_id: &str) -> Option<LegacyKey> {
    match (provider_id, field_id) {
        ("zotero", "apiKey") => Some(LegacyKey::ZoteroApiKey),
        ("zotero", "library") => Some(LegacyKey::ZoteroLibrary),
        ("semantic-scholar", "apiKey") => Some(LegacyKey::SemanticScholarKey),
        _ => None,
    }
}

/// Raw value of a legacy column.
fn legacy_value(settings: &CredentialSettings, key: LegacyKey) -> Option<&str> {
    match key {
        LegacyKey::ZoteroApiKey => settings.zotero_api_key.as_deref(),
        LegacyKey::ZoteroLibrary => settings.zotero_library.as_deref(),
        LegacyKey::SemanticScholarKey => settings.semantic_scholar_key.as_deref(),
    }
}

/// Read a provider field from the integrations bag or legacy flat columns; `None` when empty
/// (TS `getUserIntegrationField`).
#[must_use]
pub fn get_user_integration_field(
    settings: &CredentialSettings,
    provider_id: &str,
    field_id: &str,
) -> Option<String> {
    let from_bag = settings
        .integrations
        .as_ref()
        .and_then(|bags| bags.get(provider_id))
        .and_then(|bag| bag.get(field_id))
        .map(String::as_str)
        .map(js_trim)
        .filter(|value| !value.is_empty());
    if let Some(value) = from_bag {
        return Some(value.to_owned());
    }
    let key = legacy_key(provider_id, field_id)?;
    legacy_value(settings, key)
        .map(js_trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// True when the provider has at least one non-empty credential field
/// (TS `isUserIntegrationConnected`).
#[must_use]
pub fn is_user_integration_connected(
    settings: &CredentialSettings,
    provider_id: &str,
    field_ids: &[String],
) -> bool {
    field_ids
        .iter()
        .any(|id| get_user_integration_field(settings, provider_id, id).is_some())
}

/// Build the integrations bag from legacy flat columns; `None` when no field is set
/// (TS `integrationsBagFromLegacy`).
#[must_use]
pub fn integrations_bag_from_legacy(settings: &CredentialSettings) -> Option<IntegrationsBag> {
    let zotero = legacy_bag(settings, "zotero", &["apiKey", "library"]);
    let semantic_scholar = legacy_bag(settings, "semantic-scholar", &["apiKey"]);
    if zotero.is_none() && semantic_scholar.is_none() {
        return None;
    }
    Some(IntegrationsBag {
        zotero,
        semantic_scholar,
    })
}

/// One provider's bag from legacy columns; `None` when it has no non-empty field.
fn legacy_bag(
    settings: &CredentialSettings,
    provider_id: &str,
    field_ids: &[&str],
) -> Option<IntegrationCredentialBag> {
    let mut bag = IntegrationCredentialBag::new();
    for field_id in field_ids {
        let value = legacy_key(provider_id, field_id)
            .and_then(|key| legacy_value(settings, key))
            .map(js_trim)
            .filter(|value| !value.is_empty());
        if let Some(value) = value {
            let _ = bag.insert((*field_id).to_owned(), value.to_owned());
        }
    }
    (!bag.is_empty()).then_some(bag)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with_legacy() -> CredentialSettings {
        CredentialSettings {
            zotero_api_key: Some("  token-a  ".to_owned()),
            zotero_library: Some("   ".to_owned()),
            semantic_scholar_key: Some("token-b".to_owned()),
            ..CredentialSettings::default()
        }
    }

    #[test]
    fn legacy_bag_drops_blank_and_trims() {
        let bag = integrations_bag_from_legacy(&settings_with_legacy()).expect("bag");
        assert_eq!(
            bag.zotero,
            Some(IntegrationCredentialBag::from([(
                "apiKey".to_owned(),
                "token-a".to_owned()
            )]))
        );
        assert_eq!(
            bag.semantic_scholar,
            Some(IntegrationCredentialBag::from([(
                "apiKey".to_owned(),
                "token-b".to_owned()
            )]))
        );
    }

    #[test]
    fn legacy_bag_is_none_when_all_blank() {
        let settings = CredentialSettings {
            zotero_api_key: Some(String::new()),
            ..CredentialSettings::default()
        };
        assert_eq!(integrations_bag_from_legacy(&settings), None);
    }

    #[test]
    fn bag_value_wins_over_legacy() {
        let mut settings = settings_with_legacy();
        settings.integrations = Some(BTreeMap::from([(
            "zotero".to_owned(),
            IntegrationCredentialBag::from([("apiKey".to_owned(), " token-c ".to_owned())]),
        )]));
        assert_eq!(
            get_user_integration_field(&settings, "zotero", "apiKey").as_deref(),
            Some("token-c")
        );
    }

    #[test]
    fn blank_bag_value_falls_back_to_legacy() {
        let mut settings = settings_with_legacy();
        settings.integrations = Some(BTreeMap::from([(
            "zotero".to_owned(),
            IntegrationCredentialBag::from([("apiKey".to_owned(), "  ".to_owned())]),
        )]));
        assert_eq!(
            get_user_integration_field(&settings, "zotero", "apiKey").as_deref(),
            Some("token-a")
        );
    }

    #[test]
    fn unknown_field_has_no_legacy_column() {
        let settings = settings_with_legacy();
        assert_eq!(
            get_user_integration_field(&settings, "zotero", "other"),
            None
        );
        assert_eq!(
            get_user_integration_field(&settings, "unknown", "apiKey"),
            None
        );
    }

    #[test]
    fn connected_when_any_field_is_set() {
        let settings = settings_with_legacy();
        let fields = ["library".to_owned(), "apiKey".to_owned()];
        assert!(is_user_integration_connected(&settings, "zotero", &fields));
        assert!(!is_user_integration_connected(
            &CredentialSettings::default(),
            "zotero",
            &fields
        ));
    }
}

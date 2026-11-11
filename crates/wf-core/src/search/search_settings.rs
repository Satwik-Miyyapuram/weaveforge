//! Port of packages/core/src/search/parts.ts. Pure.

use serde_json::{Map, Value};

use crate::search::query::SearchKind;

/// Weights outside this range stop being a preference and become a bug (TS `MIN_FIELD_WEIGHT`).
pub const MIN_FIELD_WEIGHT: f64 = 0.0;
/// Upper bound for a field weight (TS `MAX_FIELD_WEIGHT`).
pub const MAX_FIELD_WEIGHT: f64 = 20.0;
/// Multiplier applied to a downranked kind. Enough to sink, not to hide (TS `DOWNRANK_FACTOR`).
pub const DOWNRANK_FACTOR: f64 = 0.25;

/// Default boosts; must stay in sync with `FIELD_BOOSTS` in `search-tuning.ts`.
const DEFAULT_FIELD_BOOSTS: FieldBoosts = FieldBoosts {
    title: 8.0,
    aliases: 6.0,
    headings: 3.0,
    tags: 3.0,
    path: 2.0,
    body: 1.0,
};

/// Per-field overrides (TS `SearchFieldWeights`); an absent field keeps its default.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SearchFieldWeights {
    /// Title override.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub title: Option<f64>,
    /// Aliases override.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub aliases: Option<f64>,
    /// Headings override.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub headings: Option<f64>,
    /// Tags override.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub tags: Option<f64>,
    /// Path override.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub path: Option<f64>,
    /// Body override.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub body: Option<f64>,
}

/// Effective per-field boosts (TS `Record<SearchField, number>`).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FieldBoosts {
    /// Title boost.
    pub title: f64,
    /// Aliases boost.
    pub aliases: f64,
    /// Headings boost.
    pub headings: f64,
    /// Tags boost.
    pub tags: f64,
    /// Path boost.
    pub path: f64,
    /// Body boost.
    pub body: f64,
}

/// User-tunable ranking (TS `SearchSettings`). Not `Deserialize`: `SearchKind` has no
/// `Deserialize`, so JS input goes through `normalize_search_settings` instead.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SearchSettings {
    /// Overrides for the field boosts; absent fields keep their default.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub weights: Option<SearchFieldWeights>,
    /// Kinds pushed down the results without being excluded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub downranked_kinds: Option<Vec<SearchKind>>,
    /// Recency tiebreak; on by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub recency_boost: Option<bool>,
    /// Fold diacritics when tokenizing; on by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub ignore_diacritics: Option<bool>,
    /// Additionally fold Arabic harakat.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub ignore_arabic_diacritics: Option<bool>,
}

/// A weight number clamped into `[MIN_FIELD_WEIGHT, MAX_FIELD_WEIGHT]`; non-numbers are dropped.
fn clamp_weight(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .map(|v| v.clamp(MIN_FIELD_WEIGHT, MAX_FIELD_WEIGHT))
}

fn parse_weights(input: &Map<String, Value>) -> Option<SearchFieldWeights> {
    let weights = input.get("weights")?.as_object()?;
    let weight = |key: &str| weights.get(key).and_then(clamp_weight);
    let parsed = SearchFieldWeights {
        title: weight("title"),
        aliases: weight("aliases"),
        headings: weight("headings"),
        tags: weight("tags"),
        path: weight("path"),
        body: weight("body"),
    };
    (parsed != SearchFieldWeights::default()).then_some(parsed)
}

/// Known kinds, first occurrence kept, duplicates dropped.
fn parse_downranked_kinds(input: &Map<String, Value>) -> Option<Vec<SearchKind>> {
    let items = input.get("downrankedKinds")?.as_array()?;
    let mut kinds: Vec<SearchKind> = Vec::new();
    for kind in items
        .iter()
        .filter_map(Value::as_str)
        .filter_map(SearchKind::parse)
    {
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    (!kinds.is_empty()).then_some(kinds)
}

fn parse_flag(input: &Map<String, Value>, key: &str) -> Option<bool> {
    input.get(key)?.as_bool()
}

/// Clamp and filter untrusted settings; `None` when nothing valid remains (TS `normalizeSearchSettings`).
#[must_use]
pub fn normalize_search_settings(raw: &Value) -> Option<SearchSettings> {
    let input = raw.as_object()?;
    let out = SearchSettings {
        weights: parse_weights(input),
        downranked_kinds: parse_downranked_kinds(input),
        recency_boost: parse_flag(input, "recencyBoost"),
        ignore_diacritics: parse_flag(input, "ignoreDiacritics"),
        ignore_arabic_diacritics: parse_flag(input, "ignoreArabicDiacritics"),
    };
    (out != SearchSettings::default()).then_some(out)
}

/// Effective per-field boosts: defaults with any valid override applied (TS `effectiveFieldBoosts`).
#[must_use]
pub fn effective_field_boosts(settings: Option<&SearchSettings>) -> FieldBoosts {
    let w = settings.and_then(|s| s.weights.as_ref());
    let d = DEFAULT_FIELD_BOOSTS;
    FieldBoosts {
        title: w.and_then(|w| w.title).unwrap_or(d.title),
        aliases: w.and_then(|w| w.aliases).unwrap_or(d.aliases),
        headings: w.and_then(|w| w.headings).unwrap_or(d.headings),
        tags: w.and_then(|w| w.tags).unwrap_or(d.tags),
        path: w.and_then(|w| w.path).unwrap_or(d.path),
        body: w.and_then(|w| w.body).unwrap_or(d.body),
    }
}

/// Multiplier for a kind: 1 unless the user pushed that kind down (TS `kindMultiplier`).
#[must_use]
pub fn kind_multiplier(kind: SearchKind, settings: Option<&SearchSettings>) -> f64 {
    let downranked = settings
        .and_then(|s| s.downranked_kinds.as_ref())
        .is_some_and(|kinds| kinds.contains(&kind));
    if downranked { DOWNRANK_FACTOR } else { 1.0 }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn weights_clamp_and_unknown_fields_drop() {
        let raw = json!({"weights": {"title": 50, "body": -2, "path": "x", "bogus": 3}});
        let settings = normalize_search_settings(&raw).unwrap_or_default();
        assert_eq!(
            settings.weights,
            Some(SearchFieldWeights {
                title: Some(20.0),
                body: Some(0.0),
                ..Default::default()
            })
        );
    }

    #[test]
    fn non_objects_and_nothing_valid_normalize_to_none() {
        assert_eq!(normalize_search_settings(&Value::Null), None);
        assert_eq!(normalize_search_settings(&json!([1])), None);
        assert_eq!(normalize_search_settings(&json!("x")), None);
        let raw = json!({"weights": {"bogus": 1}, "downrankedKinds": ["bogus"]});
        assert_eq!(normalize_search_settings(&raw), None);
    }

    #[test]
    fn downranked_kinds_keep_known_unique_in_order() {
        let raw = json!({"downrankedKinds": ["note", "bogus", "note", 3, "pdf"]});
        let settings = normalize_search_settings(&raw).unwrap_or_default();
        assert_eq!(
            settings.downranked_kinds,
            Some(vec![SearchKind::Note, SearchKind::Pdf])
        );
    }

    #[test]
    fn flags_pass_only_booleans() {
        let raw = json!({"recencyBoost": false, "ignoreDiacritics": "no"});
        let settings = normalize_search_settings(&raw).unwrap_or_default();
        assert_eq!(settings.recency_boost, Some(false));
        assert_eq!(settings.ignore_diacritics, None);
    }

    #[test]
    fn boosts_and_multiplier_apply_overrides() {
        let settings = SearchSettings {
            weights: Some(SearchFieldWeights {
                title: Some(12.0),
                ..Default::default()
            }),
            downranked_kinds: Some(vec![SearchKind::Note]),
            ..Default::default()
        };
        let boosts = effective_field_boosts(Some(&settings));
        assert_eq!(boosts.title, 12.0);
        assert_eq!(boosts.body, 1.0);
        assert_eq!(effective_field_boosts(None).title, 8.0);
        assert_eq!(
            kind_multiplier(SearchKind::Note, Some(&settings)),
            DOWNRANK_FACTOR
        );
        assert_eq!(kind_multiplier(SearchKind::Pdf, Some(&settings)), 1.0);
    }
}

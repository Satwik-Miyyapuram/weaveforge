//! Port of the ranking rules in packages/core/src/search/search-tuning.ts. Pure: the
//! reference time for recency is passed in, not read from the clock.

use crate::sync::instant::parse_instant;

/// Terms this many UTF-16 units or fewer are matched exactly (TS `MIN_PREFIX_LENGTH`).
pub const MIN_PREFIX_LENGTH: u32 = 3;

/// Cap on indexed body length (TS `MAX_INDEXED_BODY_CHARS`).
pub const MAX_INDEXED_BODY_CHARS: u32 = 256_000;

/// Corpus size past which the client index is likely to strain (TS `LARGE_CORPUS_WARNING`).
pub const LARGE_CORPUS_WARNING: u32 = 5_000;

/// Half-life for the recency tiebreak when none is given, in days.
const DEFAULT_HALF_LIFE_DAYS: f64 = 180.0;

const DAY_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;

/// Searchable field (TS `SearchField`). Declaration order matches `SEARCH_FIELDS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum SearchField {
    /// Document title.
    Title,
    /// Wikilink aliases and short names.
    Aliases,
    /// Markdown h1–h3 headings.
    Headings,
    /// Tags.
    Tags,
    /// Ancestor-title breadcrumb.
    Path,
    /// Body text.
    Body,
}

/// Every searchable field, in TS `SEARCH_FIELDS` order.
pub const SEARCH_FIELDS: [SearchField; 6] = [
    SearchField::Title,
    SearchField::Aliases,
    SearchField::Headings,
    SearchField::Tags,
    SearchField::Path,
    SearchField::Body,
];

/// Per-field multiplier (TS `FIELD_BOOSTS`).
#[must_use]
pub const fn field_boost(field: SearchField) -> f64 {
    match field {
        SearchField::Title => 8.0,
        SearchField::Aliases => 6.0,
        SearchField::Headings | SearchField::Tags => 3.0,
        SearchField::Path => 2.0,
        SearchField::Body => 1.0,
    }
}

/// Edit distance as a fraction of term length, graduated by length (TS `fuzzinessForTerm`).
#[must_use]
pub fn fuzziness_for_term(term: &str) -> f64 {
    let len = u32::try_from(term.encode_utf16().count()).unwrap_or(u32::MAX);
    if len <= 3 {
        0.0
    } else if len <= 5 {
        0.1
    } else {
        0.2
    }
}

/// The document fields `document_boost` reads (TS `SearchDoc` subset).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RankedDoc {
    /// Wiki-graph link degree; `0` until the graph phase fills it in.
    pub degree: f64,
    /// ISO 8601 timestamp of the last update. Missing reads as blank: no recency boost.
    #[serde(default, deserialize_with = "crate::serde_util::null_default")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub updated_at: String,
}

/// Tuning for `document_boost` (TS `DocumentBoostOptions`, without the reference time).
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct DocumentBoostOptions {
    /// Half-life for the recency tiebreak, in days.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub recency_half_life_days: Option<f64>,
    /// Multiplier from user settings (kind downranking). Defaults to 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub kind_multiplier: Option<f64>,
    /// `Some(false)` drops the recency tiebreak entirely.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub recency: Option<bool>,
}

/// Document-level multiplier on top of field scoring (TS `documentBoost`). Degree leads and
/// recency only breaks ties; `now` is epoch milliseconds supplied by the caller.
#[must_use]
pub fn document_boost(doc: &RankedDoc, options: &DocumentBoostOptions, now: f64) -> f64 {
    // Saturating: the gap between 0 and 5 links matters, between 60 and 65 it does not.
    let degree_boost = 1.0 + doc.degree.max(0.0).ln_1p() / 10_f64.ln();
    let kind_factor = options.kind_multiplier.unwrap_or(1.0);

    let recency_on = options.recency != Some(false);
    #[allow(clippy::cast_precision_loss, reason = "epoch ms stay far below 2^53")]
    let updated = parse_instant(&doc.updated_at).map(|ms| ms as f64);
    let Some(updated) = updated.filter(|_| recency_on) else {
        return degree_boost * kind_factor;
    };

    let half_life = options
        .recency_half_life_days
        .unwrap_or(DEFAULT_HALF_LIFE_DAYS);
    let age_days = ((now - updated) / DAY_MS).max(0.0);
    // Bounded to [1, 1.15] so recency can only order documents the content score has tied.
    let recency_boost = 1.0 + 0.15 * 0.5_f64.powf(age_days / half_life);

    degree_boost * recency_boost * kind_factor
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-01-01T00:00:00Z in epoch milliseconds.
    const NOW_2026: f64 = 1_767_225_600_000.0;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    fn doc(degree: f64, updated_at: &str) -> RankedDoc {
        RankedDoc {
            degree,
            updated_at: updated_at.to_owned(),
        }
    }

    #[test]
    fn fuzziness_graduates_by_utf16_length() {
        assert!(close(fuzziness_for_term("abc"), 0.0));
        assert!(close(fuzziness_for_term("abcd"), 0.1));
        assert!(close(fuzziness_for_term("abcde"), 0.1));
        assert!(close(fuzziness_for_term("abcdef"), 0.2));
        // A surrogate pair is two UTF-16 units, so this is still a short term.
        assert!(close(fuzziness_for_term("😀a"), 0.0));
    }

    #[test]
    fn field_boosts_follow_declared_order() {
        let boosts: Vec<f64> = SEARCH_FIELDS.iter().map(|f| field_boost(*f)).collect();
        assert!(boosts.windows(2).all(|w| w[0] >= w[1]));
        assert!(close(field_boost(SearchField::Title), 8.0));
        assert!(close(field_boost(SearchField::Body), 1.0));
    }

    #[test]
    fn degree_boost_is_log10_and_recency_can_be_disabled() {
        let options = DocumentBoostOptions {
            recency: Some(false),
            ..Default::default()
        };
        assert!(close(
            document_boost(&doc(0.0, "2020-01-01T00:00:00Z"), &options, NOW_2026),
            1.0
        ));
        assert!(close(
            document_boost(&doc(9.0, "2020-01-01T00:00:00Z"), &options, NOW_2026),
            2.0
        ));

        let halved = DocumentBoostOptions {
            kind_multiplier: Some(0.5),
            ..options
        };
        assert!(close(
            document_boost(&doc(9.0, "2020-01-01T00:00:00Z"), &halved, NOW_2026),
            1.0
        ));
    }

    #[test]
    fn recency_decays_with_half_life() {
        let defaults = DocumentBoostOptions::default();
        let fresh = document_boost(&doc(0.0, "2026-01-01T00:00:00Z"), &defaults, NOW_2026);
        assert!(close(fresh, 1.15));

        let one_half_life_later = NOW_2026 + 180.0 * DAY_MS;
        let aged = document_boost(
            &doc(0.0, "2026-01-01T00:00:00Z"),
            &defaults,
            one_half_life_later,
        );
        assert!(close(aged, 1.075));
    }

    #[test]
    fn unparseable_date_falls_back_to_degree_and_kind() {
        let defaults = DocumentBoostOptions::default();
        assert!(close(
            document_boost(&doc(0.0, "not a date"), &defaults, NOW_2026),
            1.0
        ));
    }
}

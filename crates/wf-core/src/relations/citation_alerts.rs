//! How strongly a citing paper asks to be read, ported from
//! `packages/core/src/features/relations/application/rank-citation-alerts.ts`.
//!
//! Higher scores sort first. Intent weight: result > method > background, and
//! `isInfluential` is a strong boost. Missing signals do not penalise (absent data
//! is the normal case), so an unsignalled item falls back to recency alone.

/// The signals a citation alert is scored on; other fields of the candidate are ignored.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CitationSignals {
    /// Publication year, when known.
    #[serde(default)]
    pub year: Option<f64>,
    /// Provider flag for highly influential citations.
    #[serde(default)]
    pub is_influential: Option<bool>,
    /// Intent labels (`background`, `method`, `result`), when the provider has them.
    /// An unknown label weighs nothing.
    #[serde(default)]
    pub intents: Option<Vec<String>>,
}

const INFLUENTIAL_BONUS: f64 = 50.0;

fn intent_weight(intent: &str) -> f64 {
    match intent {
        "result" => 30.0,
        "method" => 20.0,
        "background" => 5.0,
        _ => 0.0,
    }
}

/// Newer work ranks above older when the other signals tie.
fn recency_score(year: Option<f64>) -> f64 {
    match year {
        Some(y) if y.is_finite() => (y - 1900.0).max(0.0),
        _ => 0.0,
    }
}

/// The alert score of one candidate: recency, plus the influential bonus, plus its strongest
/// intent's weight.
#[must_use]
pub fn citation_alert_score(signals: &CitationSignals) -> f64 {
    let mut score = recency_score(signals.year);
    if signals.is_influential == Some(true) {
        score += INFLUENTIAL_BONUS;
    }
    if let Some(intents) = &signals.intents {
        score += intents.iter().map(|i| intent_weight(i)).fold(0.0, f64::max);
    }
    score
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(year: Option<f64>, inf: Option<bool>, intents: &[&str]) -> CitationSignals {
        CitationSignals {
            year,
            is_influential: inf,
            intents: if intents.is_empty() {
                None
            } else {
                Some(intents.iter().map(|i| (*i).to_owned()).collect())
            },
        }
    }

    #[test]
    fn recency_only_when_no_signals() {
        assert!((citation_alert_score(&s(Some(2020.0), None, &[])) - 120.0).abs() < f64::EPSILON);
        assert!(citation_alert_score(&s(None, None, &[])).abs() < f64::EPSILON);
        assert!(citation_alert_score(&s(Some(1800.0), None, &[])).abs() < f64::EPSILON);
        assert!(citation_alert_score(&s(Some(f64::NAN), None, &[])).abs() < f64::EPSILON);
    }

    #[test]
    fn strongest_intent_and_influential_bonus() {
        let both = s(
            Some(2000.0),
            Some(true),
            &["background", "result", "unknown"],
        );
        assert!((citation_alert_score(&both) - 180.0).abs() < f64::EPSILON);
        let method = s(Some(2000.0), Some(false), &["method"]);
        assert!((citation_alert_score(&method) - 120.0).abs() < f64::EPSILON);
    }

    #[test]
    fn reads_the_ts_candidate_shape() {
        let v: CitationSignals = serde_json::from_str(
            r#"{"id":"x","title":"t","authors":[],"year":2024,"isInfluential":true,"intents":["method"]}"#,
        )
        .unwrap();
        assert!((citation_alert_score(&v) - 194.0).abs() < f64::EPSILON);
    }
}

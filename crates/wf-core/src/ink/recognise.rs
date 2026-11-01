//! The pure parts of handwriting recognition: confidence mapping and the
//! vocabulary hint list. A port of the helpers in
//! `packages/core/src/ink/recognise.ts`; choosing an engine stays in TS
//! because it awaits each engine's probe.

use std::collections::HashSet;

use super::js_math;
use crate::search::js_text::is_js_whitespace;

/// Below this a recognised line is flagged for a look rather than trusted.
pub const INK_UNSURE_CONFIDENCE: f64 = 0.75;

/// Default cap on the vocabulary hint list.
pub const INK_VOCABULARY_LIMIT: f64 = 500.0;

/// Whether a line's confidence is too low (or missing) to trust.
#[must_use]
pub fn is_unsure_confidence(conf: f64) -> bool {
    !conf.is_finite() || conf < INK_UNSURE_CONFIDENCE
}

/// An engine's raw score mapped to `[0, 1]`, given the engine's full scale.
/// A non-finite score or a zero scale maps to `0`; a NaN scale gives NaN, as
/// the TS copy's `Math.max(0, Math.min(1, NaN))` does.
#[must_use]
pub fn map_ink_confidence(raw: f64, scale: f64) -> f64 {
    if !raw.is_finite() {
        return 0.0;
    }
    let value = if scale == 0.0 { 0.0 } else { raw / scale };
    js_math::max(0.0, js_math::min(1.0, value))
}

/// A page's confidence: the mean of its lines', a corrected line (`>= 1`)
/// counting as `1`. An empty page is `0`.
#[must_use]
pub fn ink_page_confidence(confs: &[f64]) -> f64 {
    if confs.is_empty() {
        return 0.0;
    }
    let total = confs.iter().fold(0.0, |sum, &conf| {
        sum + if conf >= 1.0 {
            1.0
        } else {
            map_ink_confidence(conf, 1.0)
        }
    });
    total / confs.len() as f64
}

/// JS `String.prototype.trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// Words to hint the recogniser with: trimmed, empty entries skipped, first
/// spelling kept per case-insensitive key, at most `limit` (checked after each
/// word, so a limit below 1 still keeps one word and NaN keeps them all).
#[must_use]
pub fn ink_vocabulary_hints(sources: &[Vec<String>], limit: f64) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for source in sources {
        for entry in source {
            let word = js_trim(entry);
            if word.is_empty() {
                continue;
            }
            if !seen.insert(word.to_lowercase()) {
                continue;
            }
            out.push(word.to_owned());
            if out.len() as f64 >= limit {
                return out;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn unsure_below_threshold_or_not_finite() {
        assert!(is_unsure_confidence(0.74));
        assert!(!is_unsure_confidence(0.75));
        assert!(is_unsure_confidence(f64::NAN));
        assert!(is_unsure_confidence(f64::INFINITY));
    }

    #[test]
    fn confidence_maps_and_clamps() {
        assert_eq!(map_ink_confidence(50.0, 100.0), 0.5);
        assert_eq!(map_ink_confidence(150.0, 100.0), 1.0);
        assert_eq!(map_ink_confidence(-1.0, 1.0), 0.0);
        assert_eq!(map_ink_confidence(f64::NAN, 1.0), 0.0);
        assert_eq!(map_ink_confidence(1.0, 0.0), 0.0);
        assert!(map_ink_confidence(1.0, f64::NAN).is_nan());
    }

    #[test]
    fn page_confidence_is_the_mean_with_corrections_as_one() {
        assert_eq!(ink_page_confidence(&[]), 0.0);
        assert_eq!(ink_page_confidence(&[0.5, 1.0, 7.0, f64::NAN]), 0.625);
    }

    #[test]
    fn vocabulary_trims_dedupes_and_stops_at_limit() {
        let sources = vec![
            words(&[" Alpha ", "", "\u{feff}beta", "ALPHA"]),
            words(&["Gamma", "delta"]),
        ];
        assert_eq!(
            ink_vocabulary_hints(&sources, INK_VOCABULARY_LIMIT),
            words(&["Alpha", "beta", "Gamma", "delta"])
        );
        assert_eq!(
            ink_vocabulary_hints(&sources, 2.0),
            words(&["Alpha", "beta"])
        );
        assert_eq!(ink_vocabulary_hints(&sources, 0.0), words(&["Alpha"]));
        assert_eq!(ink_vocabulary_hints(&sources, f64::NAN).len(), 4);
    }
}

//! The pure parts of handwriting recognition: confidence mapping and the
//! vocabulary hint list. A port of the helpers in
//! `packages/core/src/ink/recognise.ts`; choosing an engine stays in TS
//! because it awaits each engine's probe.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

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

/// A recognised line as a page carries it: its text and its confidence.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RecognisedLine {
    /// The line's text.
    pub text: String,
    /// The line's confidence.
    pub conf: f64,
}

/// What a page's text layer shows: the trimmed, non-empty lines joined by newlines,
/// the page's confidence, and how many non-empty lines are unsure.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InkPageSummary {
    /// The page's recognised text.
    pub text: String,
    /// The page's confidence.
    pub confidence: f64,
    /// How many non-empty lines are unsure.
    pub unsure: usize,
}

/// Whether two y-bands, given as `(start, end)`, overlap by at least half of the smaller
/// one. A band of no height coincides with any band it overlaps.
#[must_use]
pub fn bands_coincide(a: (f64, f64), b: (f64, f64)) -> bool {
    let overlap = js_math::min(a.1, b.1) - js_math::max(a.0, b.0);
    let smaller = js_math::min(a.1 - a.0, b.1 - b.0);
    if smaller <= 0.0 {
        overlap >= 0.0
    } else {
        overlap >= smaller / 2.0
    }
}

/// The band spanning every `(start, end)` pair in `bands`, given flat as
/// `start, end, start, end, ...`. `None` when there are no pairs; a trailing unpaired
/// number is ignored.
#[must_use]
pub fn band_union(bands: &[f64]) -> Option<(f64, f64)> {
    let mut pairs = bands.chunks_exact(2).map(|p| (p[0], p[1]));
    let first = pairs.next()?;
    Some(pairs.fold(first, |(lo, hi), (start, end)| {
        (js_math::min(lo, start), js_math::max(hi, end))
    }))
}

/// The page summary for the text layer and the page record. Blank lines are left out
/// of the text, but an empty-text line never counts as unsure, while a whitespace-only
/// line does, as the TS copy's `line.text && ...` check did.
#[must_use]
pub fn ink_page_summary(lines: &[RecognisedLine]) -> InkPageSummary {
    let text = lines
        .iter()
        .map(|line| js_trim(&line.text))
        .filter(|text| !text.is_empty())
        .collect::<Vec<&str>>()
        .join("\n");
    let confs: Vec<f64> = lines.iter().map(|line| line.conf).collect();
    let unsure = lines
        .iter()
        .filter(|line| !line.text.is_empty() && is_unsure_confidence(line.conf))
        .count();
    InkPageSummary {
        text,
        confidence: ink_page_confidence(&confs),
        unsure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn band_union_spans_every_band_and_is_none_when_empty() {
        assert_eq!(band_union(&[]), None);
        assert_eq!(
            band_union(&[10.0, 20.0, 12.0, 25.0, 5.0, 11.0]),
            Some((5.0, 25.0))
        );
        assert_eq!(band_union(&[10.0, 20.0, 99.0]), Some((10.0, 20.0)));
    }

    fn words(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    fn line(text: &str, conf: f64) -> RecognisedLine {
        RecognisedLine {
            text: text.to_owned(),
            conf,
        }
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

    #[test]
    fn bands_coincide_at_half_the_smaller_band() {
        // Overlap 6 against a smaller band of 10: at least half.
        assert!(bands_coincide((0.0, 10.0), (4.0, 14.0)));
        // Overlap 4 is short of half of 10.
        assert!(!bands_coincide((0.0, 10.0), (6.0, 16.0)));
        assert!(bands_coincide((0.0, 10.0), (0.0, 10.0)));
        assert!(!bands_coincide((0.0, 10.0), (20.0, 30.0)));
    }

    #[test]
    fn bands_of_no_height_coincide_only_when_they_touch() {
        assert!(bands_coincide((5.0, 5.0), (5.0, 5.0)));
        assert!(bands_coincide((5.0, 5.0), (0.0, 9.0)));
        assert!(!bands_coincide((5.0, 5.0), (0.0, 4.0)));
    }

    #[test]
    fn bands_with_nan_do_not_coincide() {
        assert!(!bands_coincide((f64::NAN, 10.0), (0.0, 10.0)));
    }

    #[test]
    fn page_summary_joins_trimmed_lines_and_counts_unsure() {
        let lines = [
            line("  Hello ", 0.9),
            line("", 0.1),
            line("   ", 0.2),
            line("world\u{feff}", 0.5),
        ];
        let summary = ink_page_summary(&lines);
        // Blank lines are left out of the text; the whitespace-only line is not.
        assert_eq!(summary.text, "Hello\nworld");
        // "   " is non-empty and unsure, "world" is unsure, "" is not counted.
        assert_eq!(summary.unsure, 2);
        // Mean of 0.9, 0.1, 0.2, 0.5 over all four lines.
        assert!((summary.confidence - 0.425).abs() < 1e-9);
    }

    #[test]
    fn page_summary_of_no_lines_is_empty() {
        let summary = ink_page_summary(&[]);
        assert_eq!(summary.text, "");
        assert_eq!(summary.unsure, 0);
        assert_eq!(summary.confidence, 0.0);
    }

    #[test]
    fn page_summary_counts_a_correction_as_certain() {
        let summary = ink_page_summary(&[line("Fixed", 1.0), line("Other", 0.3)]);
        assert_eq!(summary.unsure, 1);
        assert!((summary.confidence - 0.65).abs() < 1e-9);
    }
}

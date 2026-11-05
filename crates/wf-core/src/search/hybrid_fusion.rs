//! Port of the keyword and vector arm preparation before rank fusion in packages/core/src/search/hybrid-fusion.ts. Pure.
//!
//! The `covered_hit_mask` and `gate_vector_mask` functions return keep flags, not the hits:
//! the caller filters its own list with them, so the hit objects keep their shape and key order.

use std::collections::HashSet;

/// Weight of the vector list in fusion; the keyword list is 1 (TS `HYBRID_VECTOR_WEIGHT`).
pub const HYBRID_VECTOR_WEIGHT: f64 = 1.5;
/// Fewest of the query's content terms a keyword hit must match to be fused (TS `HYBRID_MIN_TERM_COVERAGE`).
pub const HYBRID_MIN_TERM_COVERAGE: f64 = 0.5;
/// Top vector hits kept even under the encoder's floor once the best hit clears it (TS `HYBRID_VECTOR_KEEP_TOP`).
pub const HYBRID_VECTOR_KEEP_TOP: f64 = 5.0;

/// Function words that carry no topic, in English (TS `STOPWORDS`).
const STOPWORDS: &[&str] = &[
    "a", "an", "the", "of", "for", "to", "in", "on", "and", "or", "with", "without", "by", "from",
    "as", "at", "is", "are", "be", "how", "what", "which", "why", "do", "does", "some", "that",
    "this", "their", "its", "into", "each", "one", "own", "so", "not", "only", "over", "between",
    "using",
];

/// JS `\s`: Unicode white space, except U+0085, plus U+FEFF.
fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// The query with bare function words removed, for the keyword arm (TS `stripStopwords`).
///
/// Only plain words go: `kind:note`, quoted phrases and `-exclusions` are syntax and pass
/// through. A query that is nothing but stopwords is returned whole.
#[must_use]
pub fn strip_stopwords(query: &str) -> String {
    let mut in_quote = false;
    let kept: Vec<&str> = query
        .split(is_js_space)
        .filter(|word| !word.is_empty())
        .filter(|word| {
            let quote_count = word.matches('"').count();
            let quoted = in_quote || quote_count > 0;
            if quote_count % 2 == 1 {
                in_quote = !in_quote;
            }
            if quoted || word.starts_with([':', '-', '"']) || word.contains(':') {
                return true;
            }
            !STOPWORDS.contains(&word.to_lowercase().as_str())
        })
        .collect();
    if kept.is_empty() {
        query.to_string()
    } else {
        kept.join(" ")
    }
}

/// Distinct non-empty terms (TS `queryTermCount`).
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "term counts are far below 2^53")]
pub fn query_term_count(terms: &[String]) -> f64 {
    let distinct: HashSet<&str> = terms
        .iter()
        .map(String::as_str)
        .filter(|term| !term.is_empty())
        .collect();
    distinct.len() as f64
}

/// Keep flags for keyword hits that matched enough of the query to fuse (TS `coveredHits`).
///
/// `query_term_counts[i]` is hit `i`'s `queryTerms.length`, or `None` when it did not report
/// them; such a hit is always kept, so the filter never drops a hit by itself.
#[must_use]
pub fn covered_hit_mask(
    query_term_counts: &[Option<f64>],
    term_count: f64,
    min_coverage: f64,
) -> Vec<bool> {
    if term_count <= 1.0 {
        return vec![true; query_term_counts.len()];
    }
    query_term_counts
        .iter()
        .map(|count| match count {
            None => true,
            Some(matched) => matched / term_count >= min_coverage,
        })
        .collect()
}

/// Keep flags for vector hits, best first, gated by the encoder's floor (TS `gateVectorHits`).
///
/// All false when the best score is under the floor; otherwise the first `keep_top` plus any
/// score at or above the floor.
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    reason = "list positions are far below 2^53"
)]
pub fn gate_vector_mask(scores: &[f64], floor: f64, keep_top: f64) -> Vec<bool> {
    let Some(best) = scores.first() else {
        return Vec::new();
    };
    if *best < floor {
        return vec![false; scores.len()];
    }
    scores
        .iter()
        .enumerate()
        .map(|(position, score)| (position as f64) < keep_top || *score >= floor)
        .collect()
}

#[cfg(test)]
#[allow(
    clippy::float_cmp,
    reason = "term counts and positions are exact small integers"
)]
mod tests {
    use super::*;

    #[test]
    fn strip_stopwords_drops_function_words() {
        assert_eq!(
            strip_stopwords("how do networks of learning work"),
            "networks learning work"
        );
    }

    #[test]
    fn strip_stopwords_keeps_syntax_and_whole_query_when_all_stopwords() {
        assert_eq!(strip_stopwords("kind:note the"), "kind:note");
        assert_eq!(strip_stopwords("\"the net\" of"), "\"the net\"");
        assert_eq!(strip_stopwords("the  of"), "the  of");
    }

    #[test]
    fn query_term_count_ignores_empty_and_repeats() {
        let terms = ["a", "a", "", "b"].map(str::to_string);
        assert_eq!(query_term_count(&terms), 2.0);
    }

    #[test]
    fn covered_hit_mask_needs_coverage_unless_single_term() {
        assert_eq!(
            covered_hit_mask(&[Some(1.0), Some(2.0), None], 4.0, 0.5),
            [false, true, true]
        );
        assert_eq!(covered_hit_mask(&[Some(0.0)], 1.0, 0.5), [true]);
    }

    #[test]
    fn gate_vector_mask_keeps_top_and_floor_hits() {
        assert_eq!(
            gate_vector_mask(&[0.9, 0.2, 0.5, 0.1], 0.6, 2.0),
            [true, true, false, false]
        );
    }

    #[test]
    fn gate_vector_mask_drops_all_when_best_under_floor() {
        assert_eq!(gate_vector_mask(&[0.5, 0.9], 0.6, 5.0), [false, false]);
        assert!(gate_vector_mask(&[], 0.6, 5.0).is_empty());
    }
}

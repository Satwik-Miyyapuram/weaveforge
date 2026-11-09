//! Deterministic lexical excerpt retrieval for the AI assistant (TS `retrieveAiExcerpts`,
//! `packages/core/src/features/ai-assistant/domain/ai-retrieval.ts`).
//!
//! Lengths and offsets follow JavaScript's UTF-16 model, so excerpts are cut where the TS cut them.

use std::cmp::Ordering;
use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::ai::access_policy::AiResourceType;
use crate::js_collate::locale_compare;
use crate::search::js_text::is_js_whitespace;

/// Where a passage came from (TS `AiSourceLink`). Passed through unchanged.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AiSourceLink {
    /// Stable id of the source.
    pub source_id: String,
    /// Display label.
    pub label: String,
    /// Kind of workspace resource.
    pub resource_type: AiResourceType,
    /// Id of the resource within its type.
    pub resource_id: String,
    /// Link target, when the resource has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
}

/// One granted document to search (TS `AiRetrievalDocument`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AiRetrievalDocument {
    /// Where the text came from.
    pub source: AiSourceLink,
    /// Already-decrypted, explicitly granted text. Never persist it.
    pub text: String,
}

/// One matching excerpt (TS `AiRetrievedExcerpt`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AiRetrievedExcerpt {
    /// Where the excerpt came from.
    pub source: AiSourceLink,
    /// `<sourceId>:0`.
    pub passage_id: String,
    /// The excerpt, with `…` marking cut ends.
    pub text: String,
    /// Sum of capped term counts; always positive in results.
    pub score: f64,
}

/// Optional limits (TS `options`). `None` takes the default.
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RetrievalOptions {
    /// Results to return, clamped to 1..=20. Default 8.
    pub limit: Option<f64>,
    /// Characters per excerpt, clamped to 120..=2000. Default 900.
    pub max_chars: Option<f64>,
}

/// Each term counts at most this many times per text.
const MAX_TERM_HITS: usize = 6;

/// Search `documents` for `query`; the best-scoring excerpts first.
///
/// Score ties sort by source label. A query with no usable term returns nothing.
#[must_use]
pub fn retrieve_ai_excerpts(
    documents: &[AiRetrievalDocument],
    query: &str,
    options: RetrievalOptions,
) -> Vec<AiRetrievedExcerpt> {
    let terms = tokenize(query);
    if terms.is_empty() {
        return Vec::new();
    }
    // Both clamped to whole positive numbers before the cast.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let limit = options.limit.unwrap_or(8.0).clamp(1.0, 20.0) as usize;
    let max_chars = options.max_chars.unwrap_or(900.0).clamp(120.0, 2000.0);

    let mut results: Vec<AiRetrievedExcerpt> = documents
        .iter()
        .map(|document| {
            let text = collapse_whitespace(&document.text);
            AiRetrievedExcerpt {
                source: document.source.clone(),
                passage_id: format!("{}:0", document.source.source_id),
                score: score_text(&text, &terms),
                text: excerpt_around_first_match(&text, &terms, max_chars),
            }
        })
        .filter(|result| result.score > 0.0 && !result.text.is_empty())
        .collect();

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| locale_compare(&a.source.label, &b.source.label))
    });
    results.truncate(limit);
    results
}

/// Distinct runs of letters, numbers, `_` and `-` of at least two characters, lowercased.
fn tokenize(value: &str) -> Vec<String> {
    let lower = value.to_lowercase();
    let mut terms: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let mut run = String::new();

    for ch in lower.chars().chain(std::iter::once(' ')) {
        if is_term_char(ch) {
            run.push(ch);
        } else {
            if run.chars().count() >= 2 && seen.insert(run.clone()) {
                terms.push(run.clone());
            }
            run.clear();
        }
    }
    terms
}

fn is_term_char(ch: char) -> bool {
    ch == '_'
        || ch == '-'
        || matches!(
            ch.general_category_group(),
            GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number
        )
}

/// Collapse runs of JS whitespace to one space and trim the ends (`replace(/\s+/g, " ").trim()`).
fn collapse_whitespace(value: &str) -> String {
    value
        .split(is_js_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Sum over terms of their occurrences in the lowercased text, each capped at [`MAX_TERM_HITS`].
fn score_text(text: &str, terms: &[String]) -> f64 {
    let lower = text.to_lowercase();
    let score: usize = terms
        .iter()
        .map(|term| lower.matches(term.as_str()).count().min(MAX_TERM_HITS))
        .sum();
    // Scores are small counts; f64 holds them exactly.
    #[allow(clippy::cast_precision_loss)]
    let score = score as f64;
    score
}

/// The text, or a window around its first match, with `…` where it was cut.
fn excerpt_around_first_match(text: &str, terms: &[String], max_chars: f64) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    // JS compares `text.length <= maxChars` in UTF-16 units; `max_chars` is a clamped whole number.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let max_units = max_chars as usize;
    if units.len() <= max_units {
        return text.to_owned();
    }

    let lower: Vec<u16> = text.to_lowercase().encode_utf16().collect();
    let first = terms
        .iter()
        .filter_map(|term| find_units(&lower, &term.encode_utf16().collect::<Vec<u16>>()))
        .min();
    // Matches the TS `Math.floor(maxChars * 0.35)` lead-in before the first hit.
    let lead = (max_chars * 0.35).floor();
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let start = first.map_or(0, |index| index.saturating_sub(lead as usize));
    // The match index comes from the lowercased text, which can be longer than the original.
    let start = start.min(units.len());
    let end = units.len().min(start + max_units);

    let body = String::from_utf16_lossy(&units[start..end]);
    let body = body.trim_matches(is_js_whitespace);
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < units.len() { "…" } else { "" };
    format!("{prefix}{body}{suffix}")
}

/// Index of the first occurrence of `needle` in `haystack` (UTF-16 units), like `indexOf`.
fn find_units(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(id: &str, label: &str) -> AiSourceLink {
        AiSourceLink {
            source_id: id.to_owned(),
            label: label.to_owned(),
            resource_type: AiResourceType::Paper,
            resource_id: id.to_owned(),
            href: None,
        }
    }

    fn doc(id: &str, label: &str, text: &str) -> AiRetrievalDocument {
        AiRetrievalDocument {
            source: source(id, label),
            text: text.to_owned(),
        }
    }

    #[test]
    fn keeps_only_matching_documents_with_passage_ids() {
        let docs = [
            doc(
                "paper:a",
                "Causal paper",
                "Causal abstraction maps a network to a causal model.",
            ),
            doc("vault:b", "Unrelated", "Meeting agenda for next week."),
        ];
        let out = retrieve_ai_excerpts(&docs, "causal model", RetrievalOptions::default());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].source.source_id, "paper:a");
        assert_eq!(out[0].passage_id, "paper:a:0");
        assert!(out[0].score > 0.0);
    }

    #[test]
    fn empty_or_single_char_query_returns_nothing() {
        let docs = [doc("a", "A", "x y z")];
        assert!(retrieve_ai_excerpts(&docs, "", RetrievalOptions::default()).is_empty());
        assert!(retrieve_ai_excerpts(&docs, "x y", RetrievalOptions::default()).is_empty());
    }

    #[test]
    fn ranks_by_capped_score_then_label() {
        let docs = [
            doc("b", "B", "graph once"),
            doc("a", "A", "graph graph graph"),
            doc("c", "C", "graph once"),
        ];
        let out = retrieve_ai_excerpts(&docs, "graph", RetrievalOptions::default());
        let ids: Vec<&str> = out.iter().map(|r| r.source.source_id.as_str()).collect();
        assert_eq!(ids, ["a", "b", "c"]);
    }

    #[test]
    fn limit_is_clamped_to_at_least_one() {
        let docs = [doc("a", "A", "graph"), doc("b", "B", "graph")];
        let opts = RetrievalOptions {
            limit: Some(0.0),
            max_chars: None,
        };
        assert_eq!(retrieve_ai_excerpts(&docs, "graph", opts).len(), 1);
    }

    #[test]
    fn long_text_is_windowed_around_the_match_with_ellipses() {
        let filler = "lorem ipsum dolor sit amet ".repeat(40);
        let text = format!("{filler}needle here {filler}");
        let docs = [doc("a", "A", &text)];
        let opts = RetrievalOptions {
            limit: None,
            max_chars: Some(120.0),
        };
        let out = retrieve_ai_excerpts(&docs, "needle", opts);
        assert_eq!(out.len(), 1);
        assert!(out[0].text.starts_with('…'));
        assert!(out[0].text.ends_with('…'));
        assert!(out[0].text.contains("needle"));
    }

    #[test]
    fn whitespace_is_collapsed_before_scoring() {
        let docs = [doc("a", "A", "alpha\n\n   beta")];
        let out = retrieve_ai_excerpts(&docs, "alpha beta", RetrievalOptions::default());
        assert_eq!(out[0].text, "alpha beta");
        assert_eq!(out[0].score, 2.0);
    }

    #[test]
    fn term_hits_are_capped_at_six() {
        assert_eq!(
            score_text("ab ab ab ab ab ab ab ab", &["ab".to_owned()]),
            6.0
        );
    }
}

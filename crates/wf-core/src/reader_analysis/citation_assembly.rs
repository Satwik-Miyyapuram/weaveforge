//! One page's citations, assembled from the text candidates. A faithful port of
//! packages/core/src/features/reader/analysis/citation-assembly.ts.
//!
//! The text candidates are the mentions; the page's own links only support them, so a
//! hyperref author-year citation set as two link boxes is one citation. Native links that no
//! candidate claims are kept and coalesced with their neighbours.

// A port of JS string and number code: the casts map UTF-16 offsets to the f64 the TS uses, and
// the float comparisons are exact on integer offsets.
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

use std::collections::HashSet;
use std::sync::LazyLock;

use regex_lite::Regex;
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::papers::js_regex::{compile, space_class};
use crate::reader_analysis::citations::{
    CitationCandidate, find_citation_candidates, in_reference_list,
};
use crate::reader_analysis::lines::{AnalysisTextRun, page_text_from_items};
use crate::reader_analysis::text::{
    AnalysisPdfItem, mention_rects, rectangles_overlap, strip_invisible,
};
use crate::reader_analysis::types::{
    AnalysisCitationMention, AnalysisPageTextRange, AnalysisPdfPage,
};
use crate::search::js_text::utf16_len;

/// `/^[\s,\(\[]*(?:19|20)\d{2}[a-z]?[\s\)\].]*$/`: a year with the punctuation around it.
static YEAR_ONLY_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    let sp = space_class();
    compile(&format!(r"^[{sp},(\[]*(?:19|20)\d{{2}}[a-z]?[{sp}\)\].]*$")).ok()
});

/// `/^[\s,(]*$/`: a gap made only of spaces and separators.
static GAP_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    let sp = space_class();
    compile(&format!(r"^[{sp},(]*$")).ok()
});

/// `/\b(?:19|20)\d{2}/`: a year anywhere in the text.
static YEAR_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\b(?:19|20)\d{2}").ok());

/// The page text: items concatenated, `\n` after each `hasEOL` item. Twin of `pageTextFromItems`.
#[must_use]
pub(crate) fn page_text(items: &[AnalysisPdfItem]) -> String {
    let runs: Vec<AnalysisTextRun> = items
        .iter()
        .map(|item| AnalysisTextRun {
            str: item.str.clone(),
            has_eol: Some(item.has_eol),
        })
        .collect();
    page_text_from_items(&runs)
}

fn matches_re(re: &LazyLock<Option<Regex>>, text: &str) -> bool {
    re.as_ref().is_some_and(|re| re.is_match(text))
}

fn has_letter(text: &str) -> bool {
    text.chars()
        .any(|c| c.general_category_group() == GeneralCategoryGroup::Letter)
}

/// `text.slice(start, end)` over UTF-16 units; an empty or inverted range gives "".
fn utf16_slice(units: &[u16], start: f64, end: f64) -> String {
    let len = units.len() as f64;
    let from = start.clamp(0.0, len) as usize;
    let to = end.clamp(0.0, len) as usize;
    if to <= from {
        return String::new();
    }
    String::from_utf16_lossy(&units[from..to])
}

/// Whether `start..end` overlaps `other`'s span. Twin of `intersectsMention`.
fn spans_overlap(start: f64, end: f64, other: &AnalysisCitationMention) -> bool {
    start < other.end && end > other.start
}

/// Two mentions name the same entry: the same destination, the same target point, or the same
/// bibliography indexes. Twin of `sameReference`.
fn same_reference(a: &AnalysisCitationMention, b: &AnalysisCitationMention) -> bool {
    if a.page != b.page {
        return false;
    }
    if let (Some(name_a), Some(name_b)) = (
        a.destination_name.as_deref().filter(|n| !n.is_empty()),
        b.destination_name.as_deref().filter(|n| !n.is_empty()),
    ) {
        return name_a == name_b;
    }
    if let (Some(ta), Some(tb)) = (&a.target, &b.target)
        && let (Some(ax), Some(bx), Some(ay), Some(by)) = (ta.x, tb.x, ta.y, tb.y)
    {
        return ta.page == tb.page && (ax - bx).abs() < 1.0 && (ay - by).abs() < 1.0;
    }
    let (ai, bi) = (&a.reference_indexes, &b.reference_indexes);
    !ai.is_empty() && ai.len() == bi.len() && ai.iter().all(|index| bi.contains(index))
}

/// The gap between `previous` and `mention` is a bare separator, and the two halves are an
/// author list and a year. Twin of `complementary` in `coalesceMentions`.
fn complementary(
    previous: &AnalysisCitationMention,
    mention: &AnalysisCitationMention,
    units: &[u16],
) -> bool {
    let gap = strip_invisible(&utf16_slice(units, previous.end, mention.start));
    previous.span_source.as_deref() != Some("text")
        && mention.span_source.as_deref() != Some("text")
        && has_letter(&previous.text)
        && !matches_re(&YEAR_RE, &previous.text)
        && matches_re(&YEAR_ONLY_RE, &mention.text)
        && utf16_len(&gap) < 24
        && matches_re(&GAP_RE, &gap)
}

/// Whether `mention` folds into `previous`: the same entry, and either overlapping or the
/// author and year halves of one citation.
fn combines(
    previous: &AnalysisCitationMention,
    mention: &AnalysisCitationMention,
    units: &[u16],
) -> bool {
    same_reference(previous, mention)
        && (mention.start < previous.end || complementary(previous, mention, units))
}

/// Folds `mention` into `previous`. A verified text span owns its boundaries; the caller has
/// already handled that case.
fn merge_into(
    previous: &mut AnalysisCitationMention,
    mention: &AnalysisCitationMention,
    units: &[u16],
    items: &[AnalysisPdfItem],
) {
    previous.end = previous.end.max(mention.end);
    previous.text = utf16_slice(units, previous.start, previous.end);
    let rects = mention_rects(items, previous.start, previous.end);
    previous.rects = if rects.is_empty() {
        let mut joined = previous.rects.clone();
        joined.extend(mention.rects.iter().cloned());
        joined
    } else {
        rects
    };
    previous.native_rects = Some(
        previous
            .native_rects
            .iter()
            .flatten()
            .chain(mention.native_rects.iter().flatten())
            .cloned()
            .collect(),
    );
    if previous.target.is_none() {
        previous.target = mention.target.clone();
    }
    if previous.destination_name.is_none() {
        previous.destination_name = mention.destination_name.clone();
    }
}

/// Merges adjacent mentions that name the same entry and either overlap or split one
/// author-year citation. Twin of `coalesceMentions`.
#[must_use]
pub fn coalesce_mentions(
    mentions: &[AnalysisCitationMention],
    text: &str,
    items: &[AnalysisPdfItem],
) -> Vec<AnalysisCitationMention> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut sorted = mentions.to_vec();
    sorted.sort_by(|a, b| a.start.total_cmp(&b.start).then(b.end.total_cmp(&a.end)));
    let mut out: Vec<AnalysisCitationMention> = Vec::new();
    for mention in sorted {
        if mention.end <= mention.start {
            continue;
        }
        if let Some(previous) = out
            .last_mut()
            .filter(|previous| combines(previous, &mention, &units))
        {
            // A verified text span owns its boundaries; annotation estimates cannot expand it.
            if previous.span_source.as_deref() == Some("text") {
                continue;
            }
            if mention.span_source.as_deref() == Some("text") {
                *previous = mention;
                continue;
            }
            merge_into(previous, &mention, &units, items);
            continue;
        }
        out.push(mention);
    }
    out
}

/// How many distinct link targets the supporting links name. Twin of the `distinctTargets` set.
fn distinct_targets(supporting: &[&AnalysisCitationMention]) -> usize {
    supporting
        .iter()
        .map(|hit| match (&hit.destination_name, &hit.target) {
            (Some(name), _) => name.clone(),
            (None, Some(target)) => serde_json::to_string(target).unwrap_or_default(),
            (None, None) => serde_json::to_string(&hit.reference_indexes).unwrap_or_default(),
        })
        .collect::<HashSet<String>>()
        .len()
}

/// Bibliography indexes of the supporting links, deduplicated in first-seen order.
fn unique_indexes(supporting: &[&AnalysisCitationMention]) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::new();
    for index in supporting
        .iter()
        .flat_map(|hit| hit.reference_indexes.iter().copied())
    {
        if !out.contains(&index) {
            out.push(index);
        }
    }
    out
}

/// The mention for one candidate, or `None` when no native link or pattern supports it. Links
/// it claims are recorded in `used`. Twin of the loop body of `assemblePageCitations`.
fn claim_candidate(
    page_number: f64,
    candidate: &CitationCandidate,
    rects: Vec<Vec<f64>>,
    native: &[AnalysisCitationMention],
    patterns: &[AnalysisCitationMention],
    used: &mut HashSet<String>,
) -> Option<AnalysisCitationMention> {
    let supporting: Vec<&AnalysisCitationMention> = native
        .iter()
        .filter(|hit| {
            if used.contains(&hit.id) {
                return false;
            }
            if hit.end > hit.start {
                return spans_overlap(candidate.start, candidate.end, hit);
            }
            hit.native_rects
                .iter()
                .flatten()
                .any(|bbox| rects.iter().any(|rect| rectangles_overlap(bbox, rect)))
        })
        .collect();
    let pattern = patterns
        .iter()
        .find(|hit| hit.start == candidate.start && hit.end == candidate.end);
    // Conflicting native targets must not be flattened into a single author-year link.
    if candidate.source == "author-year" && pattern.is_none() && distinct_targets(&supporting) > 1 {
        return None;
    }
    let (source, confidence) = match (supporting.first(), pattern) {
        (Some(_), _) => ("internal-pdf-link".to_string(), 1.0),
        (None, Some(hit)) => (candidate.source.clone(), hit.confidence),
        (None, None) => return None,
    };
    used.extend(supporting.iter().map(|hit| hit.id.clone()));
    let reference_indexes = match pattern {
        Some(hit) if !hit.reference_indexes.is_empty() => hit.reference_indexes.clone(),
        _ => unique_indexes(&supporting),
    };
    let first = supporting.first().copied();
    Some(AnalysisCitationMention {
        id: format!(
            "citation:{}:{}:{}",
            page_number, candidate.start, candidate.end
        ),
        page: page_number,
        start: candidate.start,
        end: candidate.end,
        text: candidate.text.clone(),
        rects,
        reference_indexes,
        source,
        confidence,
        target: first.and_then(|hit| hit.target.clone()),
        destination_name: first.and_then(|hit| hit.destination_name.clone()),
        native_rects: Some(
            supporting
                .iter()
                .flat_map(|hit| hit.native_rects.iter().flatten().cloned())
                .collect(),
        ),
        span_source: Some("text".to_string()),
    })
}

/// One page's citations: each text candidate that a native link or a pattern mention supports,
/// then the native links no candidate claims, coalesced. Twin of `assemblePageCitations`.
/// `candidates` of `None` are computed from the page items.
#[must_use]
pub fn assemble_page_citations(
    page: &AnalysisPdfPage,
    native: &[AnalysisCitationMention],
    patterns: &[AnalysisCitationMention],
    excluded: &[AnalysisPageTextRange],
    candidates: Option<&[CitationCandidate]>,
) -> Vec<AnalysisCitationMention> {
    let computed;
    let candidates = match candidates {
        Some(given) => given,
        None => {
            computed = find_citation_candidates(&page.items);
            &computed[..]
        }
    };
    let text = page_text(&page.items);
    let urls: Vec<[f64; 4]> = page
        .links
        .iter()
        .flatten()
        .filter(|link| link.url.as_deref().is_some_and(|url| !url.is_empty()))
        .map(|link| link.rect)
        .collect();
    let mut used: HashSet<String> = HashSet::new();
    let mut result: Vec<AnalysisCitationMention> = Vec::new();
    for candidate in candidates {
        if in_reference_list(page.page_number, candidate.start, candidate.end, excluded) {
            continue;
        }
        let rects = mention_rects(&page.items, candidate.start, candidate.end);
        if rects
            .iter()
            .any(|rect| urls.iter().any(|url| rectangles_overlap(rect, url)))
        {
            continue;
        }
        if let Some(mention) = claim_candidate(
            page.page_number,
            candidate,
            rects,
            native,
            patterns,
            &mut used,
        ) {
            result.push(mention);
        }
    }
    let remaining: Vec<AnalysisCitationMention> = native
        .iter()
        .filter(|hit| {
            !used.contains(&hit.id)
                && hit.end > hit.start
                && !result
                    .iter()
                    .any(|matched| spans_overlap(hit.start, hit.end, matched))
        })
        .cloned()
        .collect();
    let mut combined = result;
    combined.extend(remaining);
    coalesce_mentions(&combined, &text, &page.items)
}

#[cfg(test)]
mod tests {
    use super::assemble_page_citations;
    use crate::reader_analysis::text::AnalysisPdfItem;
    use crate::reader_analysis::types::{
        AnalysisCitationMention, AnalysisPageTextRange, AnalysisPdfPage,
    };

    fn item(text: &str, x: f64, width: f64) -> AnalysisPdfItem {
        AnalysisPdfItem {
            str: text.to_string(),
            transform: vec![10.0, 0.0, 0.0, 10.0, x, 700.0],
            width,
            height: 10.0,
            has_eol: false,
            font_ascent: None,
            font_descent: None,
            font_name: None,
        }
    }

    fn page() -> AnalysisPdfPage {
        AnalysisPdfPage {
            page_number: 3.0,
            items: vec![item("see [1] here", 0.0, 60.0)],
            links: None,
        }
    }

    fn mention(
        id: &str,
        start: f64,
        end: f64,
        text: &str,
        indexes: &[f64],
        span: Option<&str>,
    ) -> AnalysisCitationMention {
        AnalysisCitationMention {
            id: id.to_string(),
            page: 3.0,
            start,
            end,
            text: text.to_string(),
            rects: Vec::new(),
            reference_indexes: indexes.to_vec(),
            source: "internal-pdf-link".to_string(),
            confidence: 1.0,
            target: None,
            destination_name: None,
            native_rects: None,
            span_source: span.map(str::to_string),
        }
    }

    #[test]
    fn a_native_link_supports_the_candidate() {
        let native = [mention(
            "link:3:0",
            4.0,
            7.0,
            "[1]",
            &[1.0],
            Some("annotation"),
        )];
        let out = assemble_page_citations(&page(), &native, &[], &[], None);
        assert_eq!(out.len(), 1);
        let got = out.first();
        assert_eq!(got.map(|m| m.id.as_str()), Some("citation:3:4:7"));
        assert_eq!(got.map(|m| m.source.as_str()), Some("internal-pdf-link"));
        assert_eq!(got.map(|m| m.confidence), Some(1.0));
        assert_eq!(got.map(|m| m.reference_indexes.clone()), Some(vec![1.0]));
        assert_eq!(got.and_then(|m| m.span_source.as_deref()), Some("text"));
    }

    #[test]
    fn a_candidate_with_no_support_is_dropped() {
        assert!(assemble_page_citations(&page(), &[], &[], &[], None).is_empty());
    }

    #[test]
    fn a_pattern_mention_keeps_the_candidate_with_its_own_source() {
        let mut pattern = mention("pattern:3:4:7", 4.0, 7.0, "[1]", &[1.0], Some("text"));
        pattern.source = "numeric".to_string();
        pattern.confidence = 0.9;
        let out = assemble_page_citations(&page(), &[], &[pattern], &[], None);
        let got = out.first();
        assert_eq!(got.map(|m| m.source.as_str()), Some("numeric"));
        assert_eq!(got.map(|m| m.confidence), Some(0.9));
        assert_eq!(got.map(|m| m.reference_indexes.clone()), Some(vec![1.0]));
    }

    #[test]
    fn a_candidate_in_the_reference_list_is_dropped() {
        let pattern = [mention(
            "link:3:0",
            4.0,
            7.0,
            "[1]",
            &[1.0],
            Some("annotation"),
        )];
        let excluded = [AnalysisPageTextRange {
            page: 3.0,
            start: 0.0,
            end: 13.0,
        }];
        // A pattern hit would be claimed; native links are filtered upstream, as in TS.
        assert!(assemble_page_citations(&page(), &[], &pattern, &excluded, None).is_empty());
    }
}

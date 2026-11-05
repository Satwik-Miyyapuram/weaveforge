//! Citation mentions read from the document's own `/Link` annotations. A faithful port of
//! packages/core/src/features/reader/analysis/pdf-links.ts.
//!
//! These are support for the text candidates in `citation_assembly`, not mentions on their
//! own: an author-year citation hyperref split into two link boxes gives two of these, and
//! assembly folds them back into the one printed span.

// The float comparisons test integer-valued text offsets and reference indexes, which are
// exact; the casts map UTF-16 offsets to the f64 the TS uses.
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

use std::sync::LazyLock;

use regex_lite::Regex;

use crate::papers::js_regex::compile;
use crate::reader_analysis::citation_assembly::page_text;
use crate::reader_analysis::citations::{in_reference_list, match_author_year_text};
use crate::reader_analysis::lines::is_js_space;
use crate::reader_analysis::text::mention_rects;
use crate::reader_analysis::types::{
    AnalysisCitationMention, AnalysisLinkDest, AnalysisPageTextRange, AnalysisParsedReference,
    AnalysisPdfLink, AnalysisPdfPage,
};

/// `/^(?:cite(?:[.:/_-]|$)|bib(?:item)?[.:/_-]|bib\d)/i`: a named citation destination.
static CITE_DEST_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)^(?:cite(?:[.:/_-]|$)|bib(?:item)?[.:/_-]|bib\d)").ok());

/// Destinations that name a section, figure or the like, never a citation.
static NON_CITE_DEST_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(r"(?i)^(?:section|subsection|figure|table|equation|page|h?footnote|theorem|appendix)[.:/_\d-]")
        .ok()
});

/// `/\b(?:19|20)\d{2}[a-z]?\b/`: a year anywhere in the printed text.
static YEAR_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"\b(?:19|20)\d{2}[a-z]?\b").ok());

/// `/^(?:section|figure|table|page|equation|appendix)/i`: printed text that starts like a
/// non-citation label.
static NON_CITE_LEAD_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)^(?:section|figure|table|page|equation|appendix)").ok());

/// `/^\[?\s*(\d{1,3})\s*\]?$/`: a bare bracketed number, the numeric citation label.
static NUMERIC_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^\[?\s*(\d{1,3})\s*\]?$").ok());

fn matches_re(re: &LazyLock<Option<Regex>>, text: &str) -> bool {
    re.as_ref().is_some_and(|re| re.is_match(text))
}

/// Whether a link destination names a citation, not a section, figure or the like. Twin of
/// `isCitationDestination`.
#[must_use]
pub fn is_citation_destination(name: Option<&str>) -> bool {
    matches_re(&CITE_DEST_RE, name.unwrap_or(""))
}

/// The bibliography entry a link destination points at: on the same page, a few points
/// above or below its anchor, preferring the same column and then the nearest. Twin of
/// `referenceAtDestination`.
fn reference_at_destination<'a>(
    dest: &AnalysisLinkDest,
    refs: &'a [AnalysisParsedReference],
) -> Option<&'a AnalysisParsedReference> {
    let y = dest.y?;
    let candidates: Vec<&AnalysisParsedReference> = refs
        .iter()
        .filter(|r| r.page == dest.page && y - r.y >= -4.0 && y - r.y <= 32.0)
        .collect();
    let column: Vec<&AnalysisParsedReference> = match dest.x {
        Some(x) => candidates
            .iter()
            .copied()
            .filter(|r| (r.x - x).abs() < 70.0)
            .collect(),
        None => candidates.clone(),
    };
    let pool = if column.is_empty() {
        candidates
    } else {
        column
    };
    pool.into_iter()
        .min_by(|a, b| (y - a.y).abs().total_cmp(&(y - b.y).abs()))
}

/// A UTF-16 unit the trim strips: JS whitespace and the zero-width characters U+200B..U+200D
/// and U+2060.
fn is_trim_unit(unit: u16) -> bool {
    char::from_u32(u32::from(unit))
        .is_some_and(|c| is_js_space(c) || matches!(c, '\u{200B}'..='\u{200D}' | '\u{2060}'))
}

/// Whether a text-range bound is a whole number.
fn is_whole(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}

/// The printed span of a link: the union of its valid text ranges, trimmed. Ranges that are
/// not whole, not inside the text, or empty are ignored. `(0, 0)` when none is usable.
fn link_span(link: &AnalysisPdfLink, units: &[u16]) -> (usize, usize) {
    let len = units.len() as f64;
    let valid: Vec<(f64, f64)> = link
        .text_ranges
        .iter()
        .flatten()
        .filter(|r| {
            is_whole(r.start)
                && is_whole(r.end)
                && r.start >= 0.0
                && r.end > r.start
                && r.end <= len
        })
        .map(|r| (r.start, r.end))
        .collect();
    if valid.is_empty() {
        return (0, 0);
    }
    let start = valid.iter().map(|r| r.0).fold(f64::INFINITY, f64::min) as usize;
    let end = valid.iter().map(|r| r.1).fold(f64::NEG_INFINITY, f64::max) as usize;
    let (mut s, mut e) = (start, end);
    while s < e && is_trim_unit(units[s]) {
        s += 1;
    }
    while e > s && is_trim_unit(units[e - 1]) {
        e -= 1;
    }
    (s, e)
}

/// The numeric label a bracketed printed span names, e.g. `[12]` gives 12.
fn numeric_label(printed: &str) -> Option<f64> {
    let re = NUMERIC_RE.as_ref()?;
    re.captures(printed)?.get(1)?.as_str().parse::<f64>().ok()
}

/// One link as a citation mention, or `None` when it is not a citation. Twin of the body of
/// the `forEach` in `nativeCitationMentions`.
fn native_mention(
    page: &AnalysisPdfPage,
    index: usize,
    link: &AnalysisPdfLink,
    refs: &[AnalysisParsedReference],
    excluded: &[AnalysisPageTextRange],
    units: &[u16],
) -> Option<AnalysisCitationMention> {
    if link.url.as_deref().is_some_and(|url| !url.is_empty()) {
        return None;
    }
    let dest_name = link.dest_name.as_deref().filter(|name| !name.is_empty());
    if link.dest.is_none() && dest_name.is_none() {
        return None;
    }
    if dest_name.is_some_and(|name| matches_re(&NON_CITE_DEST_RE, name)) {
        return None;
    }
    let (start, end) = link_span(link, units);
    if in_reference_list(page.page_number, start as f64, end as f64, excluded) {
        return None;
    }
    let printed = String::from_utf16_lossy(&units[start..end]);
    let named = is_citation_destination(dest_name);
    let positioned = link
        .dest
        .as_ref()
        .and_then(|dest| reference_at_destination(dest, refs));
    let printed_refs = match_author_year_text(&printed, refs);
    let numeric_ref = numeric_label(&printed)
        .and_then(|n| refs.iter().find(|r| r.label.is_some() && r.index == n));
    let likely = named
        || !printed_refs.is_empty()
        || numeric_ref.is_some()
        || (matches_re(&YEAR_RE, &printed) && !matches_re(&NON_CITE_LEAD_RE, &printed));
    if !likely {
        return None;
    }
    let reference_indexes = if let Some(hit) = positioned {
        vec![hit.index]
    } else if !printed_refs.is_empty() {
        printed_refs
    } else {
        numeric_ref.map(|hit| vec![hit.index]).unwrap_or_default()
    };
    Some(AnalysisCitationMention {
        id: format!("link:{}:{}", page.page_number, index),
        page: page.page_number,
        start: start as f64,
        end: end as f64,
        text: printed,
        rects: mention_rects(&page.items, start as f64, end as f64),
        reference_indexes,
        source: "internal-pdf-link".to_string(),
        // Unmeasured named annotations may corroborate a parsed citation, but cannot directly
        // link an invented substring or an entire overlapping glyph run.
        confidence: if named { 1.0 } else { 0.85 },
        target: link.dest.clone(),
        destination_name: link.dest_name.clone(),
        native_rects: Some(vec![link.rect.to_vec()]),
        span_source: Some("annotation".to_string()),
    })
}

/// The page's citation-like `/Link` annotations as mentions, skipping external URLs,
/// non-citation destinations and bibliography ranges. Twin of `nativeCitationMentions`.
#[must_use]
pub fn native_citation_mentions(
    page: &AnalysisPdfPage,
    refs: &[AnalysisParsedReference],
    excluded: &[AnalysisPageTextRange],
) -> Vec<AnalysisCitationMention> {
    let units: Vec<u16> = page_text(&page.items).encode_utf16().collect();
    page.links
        .iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, link)| native_mention(page, index, link, refs, excluded, &units))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{is_citation_destination, native_citation_mentions};
    use crate::reader_analysis::text::AnalysisPdfItem;
    use crate::reader_analysis::types::{
        AnalysisLinkDest, AnalysisParsedReference, AnalysisPdfLink, AnalysisPdfPage,
        AnalysisTextSpan,
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

    fn page(links: Vec<AnalysisPdfLink>) -> AnalysisPdfPage {
        AnalysisPdfPage {
            page_number: 3.0,
            items: vec![item("see [1] here", 0.0, 60.0)],
            links: Some(links),
        }
    }

    fn link(start: f64, end: f64, dest_name: Option<&str>) -> AnalysisPdfLink {
        AnalysisPdfLink {
            rect: [0.0, 0.0, 10.0, 10.0],
            url: None,
            dest: None,
            text_ranges: Some(vec![AnalysisTextSpan { start, end }]),
            dest_name: dest_name.map(str::to_string),
        }
    }

    #[test]
    fn named_citation_destination_becomes_a_mention() {
        let out =
            native_citation_mentions(&page(vec![link(4.0, 7.0, Some("cite.smith"))]), &[], &[]);
        assert_eq!(out.len(), 1);
        let got = out.first();
        assert_eq!(got.map(|m| m.id.as_str()), Some("link:3:0"));
        assert_eq!(got.map(|m| m.text.as_str()), Some("[1]"));
        assert_eq!(got.map(|m| m.confidence), Some(1.0));
        assert_eq!(
            got.and_then(|m| m.span_source.as_deref()),
            Some("annotation")
        );
    }

    #[test]
    fn url_and_section_links_are_skipped() {
        let mut external = link(4.0, 7.0, Some("cite.smith"));
        external.url = Some("https://example.org".to_string());
        let section = link(4.0, 7.0, Some("section.2"));
        let bare = link(4.0, 7.0, None);
        assert!(native_citation_mentions(&page(vec![external]), &[], &[]).is_empty());
        assert!(native_citation_mentions(&page(vec![section]), &[], &[]).is_empty());
        assert!(native_citation_mentions(&page(vec![bare]), &[], &[]).is_empty());
    }

    #[test]
    fn out_of_text_range_is_ignored() {
        let out = native_citation_mentions(&page(vec![link(4.0, 99.0, None)]), &[], &[]);
        assert!(out.is_empty());
    }

    #[test]
    fn bare_number_destination_names_its_reference() {
        let refs = [AnalysisParsedReference {
            index: 1.0,
            label: Some("1".to_string()),
            page: 3.0,
            ..Default::default()
        }];
        let mut numeric = link(4.0, 7.0, None);
        numeric.dest = Some(AnalysisLinkDest {
            page: 3.0,
            x: None,
            y: None,
        });
        let out = native_citation_mentions(&page(vec![numeric]), &refs, &[]);
        assert_eq!(
            out.first().map(|m| m.reference_indexes.clone()),
            Some(vec![1.0])
        );
    }

    #[test]
    fn citation_destination_names() {
        assert!(is_citation_destination(Some("cite.smith2019")));
        assert!(is_citation_destination(Some("bib2")));
        assert!(is_citation_destination(Some("BIBITEM-3")));
        assert!(!is_citation_destination(Some("section.1")));
        assert!(!is_citation_destination(None));
    }
}

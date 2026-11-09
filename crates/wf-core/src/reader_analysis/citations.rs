//! Citation candidates and pattern mentions in the page text. A faithful port of
//! packages/core/src/features/reader/analysis/citations.ts.
//!
//! Offsets are UTF-16 units held as `f64`, as in the TS. Regex matches are UTF-8 byte offsets
//! and are converted with `utf16_len`.

// A port of JS string and number code: the casts map UTF-16 offsets and regex byte offsets to the
// numbers the TS produces, and the float comparisons are exact on integer offsets.
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategory, GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::papers::js_regex::compile;
use crate::reader_analysis::lines::{is_js_space, js_trim};
use crate::reader_analysis::text::{
    AnalysisPdfItem, compose_spacing_accents, mention_rects, original_range,
    search_text_from_items, strip_invisible, surname_key,
};
use crate::reader_analysis::types::{
    AnalysisCitationMention, AnalysisPageTextRange, AnalysisParsedReference,
};
use crate::search::js_text::utf16_len;

/// A candidate citation span in the page text (`CitationCandidate`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CitationCandidate {
    /// Start offset in the raw page text, in UTF-16 units.
    pub start: f64,
    /// End offset in the raw page text, in UTF-16 units.
    pub end: f64,
    /// The raw text of the span.
    pub text: String,
    /// `numeric` or `author-year`.
    pub source: String,
    /// The authors part of an author-year candidate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub authors: Option<String>,
    /// The year part of an author-year candidate, with any suffix letter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub year: Option<String>,
}

/// The `page` argument of `findPatternCitationMentions`: its number, text and text items.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CitationPage {
    /// 1-based page number.
    pub number: f64,
    /// The page text, items concatenated with `\n` after each `hasEOL` item.
    pub text: String,
    /// The page's text items.
    pub items: Vec<AnalysisPdfItem>,
}

/// Upper-case letters (`\p{Lu}`) as the body of a regex class.
pub(crate) static UPPER_CLASS: LazyLock<String> = LazyLock::new(|| class_body(is_upper));

/// Letters (`\p{L}`) as the body of a regex class.
pub(crate) static LETTER_CLASS: LazyLock<String> = LazyLock::new(|| class_body(is_letter));

/// A name (`NAME`): optional particles, then a capitalised word or an initial.
static NAME_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(&name_pattern()).ok());

/// `AUTHOR_YEAR` without the year lookahead, which `author_year_hits` applies by hand.
static AUTHOR_YEAR_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(&author_year_pattern()).ok());

/// `NUMBER_LIST`: bracketed numbers, ranges and lists.
static NUMBER_LIST_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(NUMBER_LIST).ok());

/// "et al." in any case, as the TS `/et\.?\s*al\.?/i`.
static ET_AL_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)et\.?\s*al\.?").ok());

/// Constant pattern; `None` (never reached) means no matches, not a panic.
const NUMBER_LIST: &str =
    r"\[\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?:\s*[,;]\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)*\s*\]";

/// One author-year regex hit, as byte offsets into the text it was run on.
struct AuthorYearHit {
    start: usize,
    end: usize,
    authors: String,
    year: String,
}

/// `\p{Lu}` for `regex-lite`, which has no Unicode classes: every matching code point as ranges.
fn class_body(pred: fn(char) -> bool) -> String {
    let mut out = String::new();
    let mut run: Option<(char, char)> = None;
    for c in '\0'..='\u{10FFFF}' {
        if pred(c) {
            run = Some(run.map_or((c, c), |(lo, _)| (lo, c)));
        } else if let Some((lo, hi)) = run.take() {
            out.push_str(&range_text(lo, hi));
        }
    }
    if let Some((lo, hi)) = run {
        out.push_str(&range_text(lo, hi));
    }
    out
}

/// One `\x{lo}-\x{hi}` entry of a regex class.
fn range_text(lo: char, hi: char) -> String {
    format!("\\x{{{:X}}}-\\x{{{:X}}}", u32::from(lo), u32::from(hi))
}

/// True for `\p{Lu}`.
fn is_upper(c: char) -> bool {
    c.general_category() == GeneralCategory::UppercaseLetter
}

/// True for `\p{L}`.
fn is_letter(c: char) -> bool {
    c.general_category_group() == GeneralCategoryGroup::Letter
}

/// True for `[\p{L}\d]`, the class the year lookahead excludes.
fn is_word_char(c: char) -> bool {
    is_letter(c) || c.is_ascii_digit()
}

/// The TS `NAME` pattern, with `\p{Lu}` and `\p{L}` spelled out as classes.
fn name_pattern() -> String {
    let upper = UPPER_CLASS.as_str();
    let letter = LETTER_CLASS.as_str();
    format!(
        r"(?:(?:van|von|de|der|den|del|da|di|la|le|du|dos|das)\s+)*(?:[{upper}][{letter}'\x{{2019}}\x{{2d}}]+|[{upper}]\.)"
    )
}

/// The TS `AUTHOR_YEAR` pattern. The year lookahead is left out; see `author_year_hits`.
fn author_year_pattern() -> String {
    let name = name_pattern();
    let authors = format!(r"{name}(?:\s+et\.?\s*al\.?|(?:,\s*{name})*,?\s*(?:and|&)\s*{name})?");
    format!(r"({authors})\s*(?:,\s*|\(\s*|\s+)((?:19|20)\d{{2}}[a-z]?)(?:\s*\))?")
}

/// The byte index just past the character at `index`.
fn next_char_index(text: &str, index: usize) -> usize {
    index + text[index..].chars().next().map_or(1, char::len_utf8)
}

/// Every author-year match, as JS `matchAll` finds them. A match whose year is followed by a
/// letter or digit is rejected, and the search resumes one character later, as the lookahead does.
fn author_year_hits(text: &str) -> Vec<AuthorYearHit> {
    let Some(re) = AUTHOR_YEAR_RE.as_ref() else {
        return Vec::new();
    };
    let mut hits = Vec::new();
    let mut pos = 0;
    while let Some(caps) = re.captures_at(text, pos) {
        let (Some(whole), Some(authors), Some(year)) = (caps.get(0), caps.get(1), caps.get(2))
        else {
            break;
        };
        if text[year.end()..].chars().next().is_some_and(is_word_char) {
            pos = next_char_index(text, whole.start());
            continue;
        }
        hits.push(AuthorYearHit {
            start: whole.start(),
            end: whole.end(),
            authors: authors.as_str().to_string(),
            year: year.as_str().to_string(),
        });
        pos = whole.end();
    }
    hits
}

/// The UTF-16 offset of the UTF-8 byte index `byte` in `text`.
fn utf16_at(text: &str, byte: usize) -> f64 {
    utf16_len(&text[..byte]) as f64
}

/// The UTF-16 slice `text.slice(start, end)`. A split surrogate pair becomes U+FFFD.
fn utf16_slice(text: &str, start: f64, end: f64) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let len = units.len() as f64;
    let from = start.clamp(0.0, len) as usize;
    let to = end.clamp(0.0, len) as usize;
    if to <= from {
        return String::new();
    }
    String::from_utf16_lossy(&units[from..to])
}

/// True when the unit before byte `index` is `[\p{L}\d]`. An astral character is two units in
/// the TS, so its low surrogate is neither a letter nor a digit there.
fn preceded_by_word_char(text: &str, index: usize) -> bool {
    text[..index]
        .chars()
        .next_back()
        .is_some_and(|c| c.len_utf16() == 1 && is_word_char(c))
}

/// JS `Number(part.trim())` for the digit runs `NUMBER_LIST` admits; anything else is `NaN`.
fn js_number(part: &str) -> f64 {
    let trimmed = js_trim(part);
    if trimmed.is_empty() {
        return 0.0;
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        trimmed.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `text.replace(/\s+/g, " ")` over the JS whitespace set.
fn collapse_js_space(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if is_js_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// Entry indexes that an author-year citation names. Twin of `referenceIndexes`.
fn reference_indexes(authors: &str, year: &str, refs: &[AnalysisParsedReference]) -> Vec<f64> {
    let (Some(et_al), Some(name_re)) = (ET_AL_RE.as_ref(), NAME_RE.as_ref()) else {
        return Vec::new();
    };
    let is_et_al = et_al.is_match(authors);
    let stripped = et_al.replace_all(authors, "");
    let names: Vec<String> = name_re
        .find_iter(&stripped)
        .map(|m| surname_key(m.as_str()))
        .collect();
    let Some(year_num) = year.get(..4).and_then(|y| y.parse::<f64>().ok()) else {
        return Vec::new();
    };
    let suffix = year.get(4..).unwrap_or("");
    refs.iter()
        .filter(|r| {
            let lead = surname_key(r.authors.first().map_or("", String::as_str));
            if r.year != Some(year_num) || names.first() != Some(&lead) {
                return false;
            }
            if !suffix.is_empty()
                && r.year_suffix
                    .as_deref()
                    .is_some_and(|s| !s.is_empty() && s != suffix)
            {
                return false;
            }
            if !is_et_al && names.len() > 1 {
                return names.iter().enumerate().all(|(i, name)| {
                    surname_key(r.authors.get(i).map_or("", String::as_str)) == *name
                });
            }
            true
        })
        .map(|r| r.index)
        .collect()
}

/// Entry indexes that a numeric citation names. Twin of `numericIndexes`.
fn numeric_indexes(value: &str, refs: &[AnalysisParsedReference]) -> Vec<f64> {
    let mut valid: Vec<f64> = Vec::new();
    for r in refs
        .iter()
        .filter(|r| r.label.as_deref().is_some_and(|l| !l.is_empty()))
    {
        if !valid.contains(&r.index) {
            valid.push(r.index);
        }
    }
    let mut result: Vec<f64> = Vec::new();
    let stripped: String = value.chars().filter(|c| !matches!(c, '[' | ']')).collect();
    for part in stripped.split([',', ';']) {
        let ends: Vec<f64> = part
            .split(['-', '\u{2013}', '\u{2014}'])
            .map(js_number)
            .collect();
        let (Some(&first), Some(&last)) = (ends.first(), ends.last()) else {
            return Vec::new();
        };
        if first == 0.0 || first.is_nan() || last == 0.0 || last.is_nan() {
            return Vec::new();
        }
        if last < first || last - first > valid.len() as f64 {
            return Vec::new();
        }
        let mut n = first;
        while n <= last {
            if !valid.contains(&n) {
                return Vec::new();
            }
            if !result.contains(&n) {
                result.push(n);
            }
            n += 1.0;
        }
    }
    result
}

/// Entry indexes named by the author-year and numeric citations in `text`, deduplicated in
/// first-seen order. Twin of `matchAuthorYearText`.
#[must_use]
pub fn match_author_year_text(text: &str, refs: &[AnalysisParsedReference]) -> Vec<f64> {
    let composed = compose_spacing_accents(text).nfkc().collect::<String>();
    let normalized = collapse_js_space(&strip_invisible(&composed));
    let mut out: Vec<f64> = Vec::new();
    for hit in author_year_hits(&normalized) {
        for index in reference_indexes(&hit.authors, &hit.year, refs) {
            if !out.contains(&index) {
                out.push(index);
            }
        }
    }
    out
}

/// True when `start..end` on `page` overlaps one of `ranges`. Twin of `inReferenceList`.
#[must_use]
pub fn in_reference_list(
    page: f64,
    start: f64,
    end: f64,
    ranges: &[AnalysisPageTextRange],
) -> bool {
    ranges
        .iter()
        .any(|range| range.page == page && start < range.end && end > range.start)
}

/// Numeric and author-year candidates in the page items, sorted by start. Twin of
/// `findCitationCandidates`.
#[must_use]
pub fn find_citation_candidates(items: &[AnalysisPdfItem]) -> Vec<CitationCandidate> {
    let search = search_text_from_items(items);
    let raw: String = items
        .iter()
        .map(|item| {
            if item.has_eol {
                format!("{}\n", item.str)
            } else {
                item.str.clone()
            }
        })
        .collect();
    let mut candidates = Vec::new();
    if let Some(number_list) = NUMBER_LIST_RE.as_ref() {
        for m in number_list.find_iter(&search.text) {
            let [start, end] = original_range(
                &search,
                utf16_at(&search.text, m.start()),
                utf16_at(&search.text, m.end()),
            );
            candidates.push(CitationCandidate {
                start,
                end,
                text: utf16_slice(&raw, start, end),
                source: "numeric".to_string(),
                authors: None,
                year: None,
            });
        }
    }
    for hit in author_year_hits(&search.text) {
        if hit.start > 0 && preceded_by_word_char(&search.text, hit.start) {
            continue;
        }
        let [start, end] = original_range(
            &search,
            utf16_at(&search.text, hit.start),
            utf16_at(&search.text, hit.end),
        );
        candidates.push(CitationCandidate {
            start,
            end,
            text: utf16_slice(&raw, start, end),
            source: "author-year".to_string(),
            authors: Some(hit.authors),
            year: Some(hit.year),
        });
    }
    candidates.sort_by(|a, b| a.start.total_cmp(&b.start));
    candidates
}

/// Pattern citation mentions on one page that name bibliography entries, sorted by start.
/// `candidates` of `None` are computed from the page items. Twin of
/// `findPatternCitationMentions`.
#[must_use]
pub fn find_pattern_citation_mentions(
    page: &CitationPage,
    refs: &[AnalysisParsedReference],
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
    let mut out: Vec<AnalysisCitationMention> = Vec::new();
    for candidate in candidates {
        let indexes = if refs.is_empty() {
            Vec::new()
        } else if candidate.source == "numeric" {
            numeric_indexes(&candidate.text, refs)
        } else {
            reference_indexes(
                candidate.authors.as_deref().unwrap_or(""),
                candidate.year.as_deref().unwrap_or(""),
                refs,
            )
        };
        let (start, end) = (candidate.start, candidate.end);
        if indexes.is_empty() && !refs.is_empty() {
            continue;
        }
        if in_reference_list(page.number, start, end, excluded) || end <= start {
            continue;
        }
        if out.iter().any(|hit| start < hit.end && end > hit.start) {
            continue;
        }
        let confidence = match indexes.len() {
            0 => 0.6,
            1 => 0.9,
            _ => 0.72,
        };
        out.push(AnalysisCitationMention {
            id: format!("pattern:{}:{}:{}", page.number, start, end),
            page: page.number,
            start,
            end,
            text: utf16_slice(&page.text, start, end),
            rects: mention_rects(&page.items, start, end),
            reference_indexes: indexes,
            source: candidate.source.clone(),
            confidence,
            target: None,
            destination_name: None,
            native_rects: None,
            span_source: Some("text".to_string()),
        });
    }
    out.sort_by(|a, b| a.start.total_cmp(&b.start));
    out
}

#[cfg(test)]
mod tests {
    use super::{
        AnalysisPageTextRange, AnalysisParsedReference, AnalysisPdfItem, CitationPage,
        find_citation_candidates, find_pattern_citation_mentions, in_reference_list,
        match_author_year_text,
    };

    fn item(text: &str) -> AnalysisPdfItem {
        AnalysisPdfItem {
            str: text.to_string(),
            transform: vec![1.0, 0.0, 0.0, 10.0, 0.0, 0.0],
            width: 6.0 * text.chars().count() as f64,
            height: 10.0,
            has_eol: false,
            font_ascent: None,
            font_descent: None,
            font_name: None,
        }
    }

    fn reference(
        index: f64,
        label: Option<&str>,
        authors: &[&str],
        year: f64,
    ) -> AnalysisParsedReference {
        AnalysisParsedReference {
            index,
            label: label.map(str::to_string),
            raw: String::new(),
            page: 9.0,
            x: 0.0,
            y: 0.0,
            authors: authors.iter().map(ToString::to_string).collect(),
            year: Some(year),
            ..Default::default()
        }
    }

    #[test]
    fn author_year_names_the_entry_with_et_al() {
        let refs = [reference(1.0, Some("[1]"), &["Smith", "Jones"], 2014.0)];
        assert_eq!(
            match_author_year_text("As shown by Smith et al., 2014a.", &refs),
            vec![1.0]
        );
    }

    #[test]
    fn year_followed_by_a_letter_is_no_citation() {
        let refs = [reference(1.0, Some("[1]"), &["Smith"], 2014.0)];
        assert!(match_author_year_text("Smith 2014ab", &refs).is_empty());
    }

    #[test]
    fn numeric_candidate_keeps_raw_bracket_text() {
        let candidates = find_citation_candidates(&[item("see "), item("[1, 3-4]")]);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].text, "[1, 3-4]");
        assert_eq!(candidates[0].start, 4.0);
        assert_eq!(candidates[0].source, "numeric");
    }

    #[test]
    fn numeric_list_names_labelled_entries_with_middling_confidence() {
        let refs: Vec<AnalysisParsedReference> = (1..=4)
            .map(|n| reference(f64::from(n), Some(&format!("[{n}]")), &["X"], 2000.0))
            .collect();
        let page = CitationPage {
            number: 2.0,
            text: "see [1, 3-4]".to_string(),
            items: vec![item("see "), item("[1, 3-4]")],
        };
        let mentions = find_pattern_citation_mentions(&page, &refs, &[], None);
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].reference_indexes, vec![1.0, 3.0, 4.0]);
        assert_eq!(mentions[0].confidence, 0.72);
        assert_eq!(mentions[0].id, "pattern:2:4:12");
        assert_eq!(mentions[0].span_source.as_deref(), Some("text"));
    }

    #[test]
    fn letter_before_author_name_is_no_candidate() {
        let candidates = find_citation_candidates(&[item("xSmith 2014")]);
        assert!(candidates.is_empty());
    }

    #[test]
    fn reference_list_overlap_is_half_open() {
        let ranges = [AnalysisPageTextRange {
            page: 3.0,
            start: 10.0,
            end: 20.0,
        }];
        assert!(in_reference_list(3.0, 15.0, 16.0, &ranges));
        assert!(!in_reference_list(3.0, 20.0, 25.0, &ranges));
        assert!(!in_reference_list(4.0, 15.0, 16.0, &ranges));
    }
}

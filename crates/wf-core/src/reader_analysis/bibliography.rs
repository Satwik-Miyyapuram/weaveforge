//! Bibliography entry splitting and field parsing (Rust twin of
//! `packages/core/src/features/reader/analysis/bibliography-parser.ts`).
//!
//! Offsets are UTF-8 byte offsets. Patterns are `regex-lite` with Unicode classes spelled
//! out: `@L@` is `\p{L}`, `@U@` is `\p{Lu}`, `@S@` is JS `\s` as a class body. Lookarounds
//! are hand-coded where `regex-lite` lacks them.

#![allow(clippy::cast_precision_loss)]

use std::sync::OnceLock;

use regex_lite::{Captures, Regex};
use unicode_properties::{GeneralCategory, GeneralCategoryGroup, UnicodeGeneralCategory};

use super::lines::{AnalysisTextLine, is_js_space, js_trim, js_trim_start};
use super::types::AnalysisParsedReference;
use crate::ink::js_math;
use crate::papers::js_regex::{compile, space_class};
use crate::search::js_text::utf16_len;

/// A Unicode general-category class body (`\p{L}` or `\p{Lu}`) for `regex-lite`.
fn category_body(upper_only: bool) -> String {
    let mut ranges: Vec<(u32, u32)> = Vec::new();
    for c in '\0'..=char::MAX {
        let hit = if upper_only {
            matches!(c.general_category(), GeneralCategory::UppercaseLetter)
        } else {
            matches!(c.general_category_group(), GeneralCategoryGroup::Letter)
        };
        if hit {
            let v = c as u32;
            match ranges.last_mut() {
                Some((_, end)) if *end + 1 == v => *end = v,
                _ => ranges.push((v, v)),
            }
        }
    }
    ranges
        .iter()
        .map(|&(a, b)| {
            if a == b {
                format!("\\x{{{a:X}}}")
            } else {
                format!("\\x{{{a:X}}}-\\x{{{b:X}}}")
            }
        })
        .collect()
}

fn letters() -> &'static str {
    static S: OnceLock<String> = OnceLock::new();
    S.get_or_init(|| category_body(false))
}

fn uppercase() -> &'static str {
    static S: OnceLock<String> = OnceLock::new();
    S.get_or_init(|| category_body(true))
}

/// Fills the `@L@`, `@U@` and `@S@` placeholders of a pattern.
fn pat(src: &str) -> String {
    src.replace("@L@", letters())
        .replace("@U@", uppercase())
        .replace("@S@", space_class())
}

macro_rules! static_re {
    ($name:ident, $src:expr) => {
        fn $name() -> &'static Regex {
            static RE: OnceLock<Regex> = OnceLock::new();
            RE.get_or_init(|| match compile(&pat($src)) {
                Ok(re) => re,
                Err(err) => unreachable!("static pattern failed to compile: {err}"),
            })
        }
    };
}

static_re!(re_year, r"\b(?:19|20)\d\d[a-z]?\b");
static_re!(re_year_capture, r"\b((?:19|20)\d\d)([a-z]?)\b");
static_re!(re_quote, r#"["“]([^"”]+)["”]"#);
static_re!(re_doi, r#"(?i)10\.\d{4,9}/[^@S@"<>]+"#);
static_re!(
    re_arxiv,
    r"(?i)(?:arXiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)"
);
static_re!(re_url, r#"(?i)https?://[^@S@"<>]+"#);
static_re!(re_doi_prefix, r"(?i)^https?://(dx\.)?doi\.org/");
static_re!(re_et_al, r"(?i)\bet\s+al\.?");
static_re!(re_etal_split, r"(?i)^(.+?\bet\s+al\.?)[,.:@S@]+(.+)$");
static_re!(
    re_and_split,
    r"^(.+?\b(?:and|&)\s+(?:(?:[A-Z]\.\s*)+[@L@'’\-]+|[@L@'’\-]+(?:,\s+(?:[A-Z]\.\s*)*[A-Z])?))\.\s+([@U@].+)$"
);
static_re!(
    re_author_list,
    r"^((?:[@L@'’\-]+,\s+(?:[A-Z]\.\s*)+,?\s*)+)\s*([@U@].+)$"
);
static_re!(re_dot_split, r"^([^\n.]{3,100}\.)\s+([@U@].+)$");
static_re!(re_in_split, r"\.\s+(?:In|in)\s+|\s+,\s*(?:in|In)\s+");
static_re!(
    re_in_venue,
    concat!(
        r"(?i)\bIn\s+([^\n\r",
        "\u{2028}\u{2029}",
        r"]{3,90}?)(?:\.|,\s*\d{4}|$)"
    )
);
static_re!(
    re_venue_words,
    r"(?i)(?:Proceedings|Journal|Transactions|Symposium|Congress|Workshop|Conference|NeurIPS|ICML|ICLR|CVPR|ICCV|ECCV|ACL|EMNLP|NAACL|AAAI|IJCAI|KDD|SIGIR|SIGMOD|CHI|WWW|Nature|Science|Cell|IEEE|ACM|Springer|Elsevier|arXiv preprint|Technical Report|Tech\. Rep)"
);
static_re!(
    re_venue_tail,
    r"\s*,\s*(?:(?:19|20)\d{2}[a-z]?|pp?\.?\s*[\d–-]+)\s*$"
);
static_re!(re_space_comma, r"\s+,");
static_re!(re_segments, r"\.\s+");
static_re!(re_surname_first, r"^[@L@'’–-]+,\s");
static_re!(re_name, r"^[@L@'’–-]{2,}$");
static_re!(re_author_split, r"(?i)\s+(?:and|&)\s+|;");
static_re!(
    re_early_a,
    r"^([^\d]{3,120}?)[@S@,]*[\(\[]?((?:19|20)\d\d)([a-z]?)[\)\]]?[.:]\s+(.+)$"
);
static_re!(
    re_early_b,
    r"^([^\d]{3,600}?)[@S@,]*[\(\[]((?:19|20)\d\d)([a-z]?)[\)\]][.:]\s+(.+)$"
);
static_re!(
    re_author_start,
    r"^[A-Z][@L@'’\-]+(?:,\s+[A-Z]\.|\s+[A-Z]\.|\s+et\s+al)"
);

const STOPWORDS: [&str; 8] = ["al", "et", "In", "and", "the", "of", "for", "with"];

/// The JS exec array of `LABEL` as `[whole, g1, g2, g3, g4, g5]`, plus the match length.
pub(crate) struct LabelMatch {
    pub(crate) len: usize,
    pub(crate) label: String,
    pub(crate) groups: Vec<Option<String>>,
}

fn digit_run(s: &str) -> usize {
    s.bytes().take_while(u8::is_ascii_digit).count()
}

fn ws_len(s: &str) -> usize {
    s.len() - js_trim_start(s).len()
}

fn is_upper(c: char) -> bool {
    matches!(c.general_category(), GeneralCategory::UppercaseLetter)
}

/// Hand-coded `LABEL`: `regex-lite` has no lookahead for the bare `12 Smith` form.
pub(crate) fn match_label(text: &str) -> Option<LabelMatch> {
    // `[n]`, `(n)`, or `n.` before whitespace; that whitespace is part of the match.
    for (open, close) in [('[', ']'), ('(', ')')] {
        let Some(body) = text.strip_prefix(open) else {
            continue;
        };
        let n = digit_run(body);
        if n > 0 && body[n..].starts_with(close) {
            let label_len = n + 2;
            let len = label_len + ws_len(&text[label_len..]);
            let mut groups = vec![
                Some(text[..len].to_string()),
                Some(text[..label_len].to_string()),
                None,
                None,
                None,
                None,
            ];
            groups[if open == '[' { 2 } else { 3 }] = Some(body[..n].to_string());
            return Some(LabelMatch {
                len,
                label: text[..label_len].to_string(),
                groups,
            });
        }
    }
    let n = digit_run(text);
    if n == 0 {
        return None;
    }
    let rest = &text[n..];
    if rest.starts_with('.') && rest[1..].chars().next().is_some_and(is_js_space) {
        let label_len = n + 1;
        let len = label_len + ws_len(&text[label_len..]);
        return Some(LabelMatch {
            len,
            label: text[..label_len].to_string(),
            groups: vec![
                Some(text[..len].to_string()),
                Some(text[..label_len].to_string()),
                None,
                None,
                Some(text[..n].to_string()),
                None,
            ],
        });
    }
    // Bare `12 Smith`, `12-Smith`: the next character must be whitespace or uppercase.
    let sep = rest.chars().next()?;
    if !matches!(sep, ' ' | '.' | '-') {
        return None;
    }
    let next = rest[1..].chars().next()?;
    if !(is_js_space(next) || is_upper(next)) {
        return None;
    }
    Some(LabelMatch {
        len: n + 1,
        label: text[..n].to_string(),
        groups: vec![
            Some(text[..n + 1].to_string()),
            None,
            None,
            None,
            None,
            Some(text[..n].to_string()),
        ],
    })
}

/// Entry number from the JS exec groups `[whole, g1..g5]`: the first set of `g2..g5`.
#[must_use]
pub fn label_number(groups: &[Option<String>]) -> f64 {
    (2..=5)
        .find_map(|i| groups.get(i).and_then(|g| g.as_deref()))
        .and_then(|digits| digits.parse::<f64>().ok())
        .unwrap_or(f64::NAN)
}

/// Entries split where `starts` says a line opens one; lines before the first start are dropped.
fn split_entries(
    lines: &[AnalysisTextLine],
    starts: impl Fn(usize, &AnalysisTextLine, &[AnalysisTextLine]) -> bool,
) -> Vec<Vec<AnalysisTextLine>> {
    let mut entries: Vec<Vec<AnalysisTextLine>> = Vec::new();
    let mut current: Vec<AnalysisTextLine> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if starts(i, line, &current) {
            if !current.is_empty() {
                entries.push(std::mem::take(&mut current));
            }
            current.push(line.clone());
        } else if !current.is_empty() {
            current.push(line.clone());
        }
    }
    if !current.is_empty() {
        entries.push(current);
    }
    entries
}

/// Entries by label, insisting on a monotonic sequence so a year in an entry never splits it.
#[must_use]
pub fn split_numbered_entries(lines: &[AnalysisTextLine]) -> Vec<Vec<AnalysisTextLine>> {
    let mut entries: Vec<Vec<AnalysisTextLine>> = Vec::new();
    let mut current: Vec<AnalysisTextLine> = Vec::new();
    let mut expected = 1.0_f64;
    for line in lines {
        if let Some(m) = match_label(&line.text) {
            let num = label_number(&m.groups);
            let is_start = entries.is_empty() && current.is_empty();
            if (is_start && num == 1.0) || (!is_start && num >= expected && num <= expected + 5.0) {
                if !current.is_empty() {
                    entries.push(std::mem::take(&mut current));
                }
                current.push(line.clone());
                expected = num + 1.0;
                continue;
            }
        }
        if !current.is_empty() {
            current.push(line.clone());
        }
    }
    if !current.is_empty() {
        entries.push(current);
    }
    entries
}

/// Gives every line of a finished column the column's minimum left edge.
fn set_column_margin(lines: &[AnalysisTextLine], column: &mut Vec<usize>, margins: &mut [f64]) {
    let Some((&first, rest)) = column.split_first() else {
        return;
    };
    let min = rest
        .iter()
        .fold(lines[first].x, |acc, &i| js_math::min(acc, lines[i].x));
    for &i in column.iter() {
        margins[i] = min;
    }
    column.clear();
}

/// Unnumbered entries where the left margin jumps back to its column minimum.
#[must_use]
pub fn split_by_margins(lines: &[AnalysisTextLine]) -> Vec<Vec<AnalysisTextLine>> {
    let mut margins = vec![f64::NAN; lines.len()];
    let mut column: Vec<usize> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if let Some(prev) = column.last().copied() {
            let previous = &lines[prev];
            if line.page != previous.page || line.y > previous.y + 20.0 {
                set_column_margin(lines, &mut column, &mut margins);
            }
        }
        column.push(i);
    }
    set_column_margin(lines, &mut column, &mut margins);
    split_entries(lines, |i, line, _| (line.x - margins[i]).abs() <= 2.0)
}

fn join_texts(lines: &[AnalysisTextLine], sep: &str) -> String {
    lines
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join(sep)
}

/// Entries by the surname and initials (or "et al") that open each one.
#[must_use]
pub fn split_by_author_start(lines: &[AnalysisTextLine]) -> Vec<Vec<AnalysisTextLine>> {
    split_entries(lines, |_, line, previous| {
        re_author_start().is_match(&line.text)
            && (previous.is_empty() || re_year().is_match(&join_texts(previous, " ")))
    })
}

/// Splits by the first format that yields at least three entries.
#[must_use]
pub fn split_bibliography_entries(lines: &[AnalysisTextLine]) -> Vec<Vec<AnalysisTextLine>> {
    let mut entries = split_numbered_entries(lines);
    if entries.len() < 3 {
        entries = split_by_margins(lines);
    }
    if entries.len() < 3 {
        entries = split_by_author_start(lines);
    }
    entries
}

fn non_empty(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_string())
}

fn parse_year(s: &str) -> f64 {
    s.parse::<f64>().unwrap_or(f64::NAN)
}

fn group<'h>(caps: &Captures<'h>, i: usize) -> &'h str {
    caps.get(i).map_or("", |m| m.as_str())
}

/// `clean_title`: strips trailing punctuation and wrapping quotes; titles of 3 or fewer are dropped.
fn clean_title(s: Option<&str>) -> Option<String> {
    let s = s?;
    if s.is_empty() {
        return None;
    }
    let t = s.trim_end_matches(&['.', ',', ';', ':'][..]);
    let t = t.trim_start_matches(&['"', '“', '\''][..]);
    let t = js_trim(t.trim_end_matches(&['"', '”', '\''][..]));
    (utf16_len(t) > 3).then(|| t.to_string())
}

fn extract_authors(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let stripped = re_et_al().replace_all(text, "");
    re_author_split()
        .split(&stripped)
        .flat_map(|part| -> Vec<String> {
            let trimmed = js_trim(part);
            // Surname, Given in author-year lists; Given Surname in numbered ones.
            if re_surname_first().is_match(trimmed) {
                return vec![trimmed.split(',').next().unwrap_or("").to_string()];
            }
            part.split(',')
                .map(|name| {
                    let name = js_trim(name).trim_end_matches(|c: char| c == '.' || is_js_space(c));
                    name.split(is_js_space)
                        .next_back()
                        .unwrap_or("")
                        .to_string()
                })
                .collect()
        })
        .filter(|name| {
            re_name().is_match(name) && !STOPWORDS.iter().any(|w| name.eq_ignore_ascii_case(w))
        })
        .collect()
}

fn tidy_venue(venue: &str) -> String {
    let t = re_venue_tail().replace(js_trim(venue), "");
    let t = re_space_comma().replace_all(&t, ",");
    js_trim(t.trim_end_matches(&['.', ','][..])).to_string()
}

/// The venue, if one is printed: an explicit "In ..." that names a venue, else the first later
/// segment carrying a venue word. Conservative, since a wrong venue is worse than none.
#[must_use]
pub fn extract_venue(after_title: &str) -> Option<String> {
    if let Some(c) = re_in_venue().captures(after_title) {
        let name = group(&c, 1);
        if re_venue_words().is_match(name) {
            return Some(tidy_venue(name));
        }
    }
    for segment in re_segments().split(after_title) {
        let trimmed = js_trim(segment).trim_end_matches(&['.', ','][..]);
        if (3..=90).contains(&utf16_len(trimmed))
            && re_venue_words().is_match(trimmed)
            && !trimmed.bytes().all(|b| b.is_ascii_digit())
        {
            return Some(tidy_venue(trimmed));
        }
    }
    None
}

fn strip_url_tail(s: &str) -> &str {
    s.trim_end_matches(&['.', ',', ';', ')'][..])
}

fn normalize_doi(doi: &str) -> Option<String> {
    if doi.is_empty() {
        return None;
    }
    Some(re_doi_prefix().replace(js_trim(doi), "").to_lowercase())
}

/// `(year, suffix)` for every `\b((?:19|20)\d\d)([a-z]?)\b` in the text.
fn year_matches(text: &str) -> Vec<(f64, Option<String>)> {
    re_year_capture()
        .captures_iter(text)
        .map(|c| (parse_year(group(&c, 1)), non_empty(group(&c, 2))))
        .collect()
}

fn last_year(years: &[(f64, Option<String>)]) -> (Option<f64>, Option<String>) {
    years
        .last()
        .map_or((None, None), |(year, suffix)| (Some(*year), suffix.clone()))
}

/// `splitBy` the title split of `afterYear` (lookarounds hand-coded): text before the first cut.
/// `digits_and_quotes` is the early-year lookahead, which also admits digits and opening quotes.
fn title_cut(text: &str, digits_and_quotes: bool) -> &str {
    for (i, c) in text.char_indices() {
        if c != '.' && c != '?' {
            continue;
        }
        let after = &text[i + 1..];
        let rest = js_trim_start(after);
        let spaced = rest.len() < after.len();
        if c == '.' {
            // `\.\s+(?=...)` or `\.\s*$`
            if (spaced && title_start(rest, digits_and_quotes)) || rest.is_empty() {
                return &text[..i];
            }
        } else if spaced && title_start(rest, false) {
            // `(?<=\?)\s+(?=...)` cuts after the question mark
            return &text[..i + 1];
        }
    }
    text
}

/// The `(?=[A-Z]|In\s|in\s)` lookahead, plus `[0-9"“]` when `digits_and_quotes`.
fn title_start(rest: &str, digits_and_quotes: bool) -> bool {
    let starts_word = |word: &str| {
        rest.strip_prefix(word)
            .and_then(|r| r.chars().next())
            .is_some_and(is_js_space)
    };
    match rest.chars().next() {
        Some(c) if c.is_ascii_uppercase() => true,
        Some(c) if digits_and_quotes && (c.is_ascii_digit() || c == '"' || c == '“') => true,
        _ => starts_word("In") || starts_word("in"),
    }
}

/// One entry's fields. Shapes, in order: a quoted title, an early year (APA/Harvard), then the
/// late-year conference form. `None` for empty input (the TS version throws there).
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn parse_bibliography_entry(
    entry_lines: &[AnalysisTextLine],
    index: f64,
    with_offsets: bool,
) -> Option<AnalysisParsedReference> {
    let first = entry_lines.first()?;
    let last = entry_lines.last()?;
    let raw = js_trim(
        &join_texts(entry_lines, "\n")
            .replace("-\n", "")
            .replace('\n', " "),
    )
    .to_string();
    let label = match_label(&raw);
    let text = js_trim(&raw[label.as_ref().map_or(0, |m| m.len)..]).to_string();

    let doi = re_doi()
        .find(&text)
        .and_then(|m| normalize_doi(strip_url_tail(m.as_str())));
    let arxiv_id = re_arxiv()
        .captures(&text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let url = re_url()
        .find(&text)
        .map(|m| strip_url_tail(m.as_str()).to_string());
    let years = year_matches(&text);

    let entry = AnalysisParsedReference {
        index: label.as_ref().map_or(index, |m| label_number(&m.groups)),
        label: label.as_ref().map(|m| m.label.clone()),
        raw,
        page: first.page,
        x: first.x,
        y: first.y,
        start: with_offsets.then_some(first.start),
        end: with_offsets.then_some(last.end),
        doi,
        arxiv_id,
        url,
        ..Default::default()
    };

    let quote = re_quote()
        .captures(&text)
        .and_then(|c| Some((c.get(0)?, c.get(1)?)));
    let (authors, year, year_suffix, title, venue) = if let Some((whole, inner)) = quote {
        let author_text = text[..whole.start()]
            .trim_end_matches(|c: char| matches!(c, ',' | '.' | ':') || is_js_space(c));
        let (year, suffix) = last_year(&years);
        (
            extract_authors(author_text),
            year,
            suffix,
            Some(js_trim(inner.as_str()).to_string()),
            extract_venue(&text[whole.end()..]),
        )
    } else if let Some(c) = re_early_a()
        .captures(&text)
        .or_else(|| re_early_b().captures(&text))
    {
        let after_year = group(&c, 4);
        let cut = title_cut(after_year, true);
        (
            extract_authors(group(&c, 1)),
            Some(parse_year(group(&c, 2))),
            non_empty(group(&c, 3)),
            Some(cut.to_string()),
            extract_venue(&after_year[cut.len()..]),
        )
    } else {
        // The venue clause is cut off before the author and title patterns run.
        let pre_venue: &str = match re_in_split().find(&text) {
            Some(m) => &text[..m.start()],
            None => text.as_str(),
        };
        let (authors, title) = if let Some(c) = re_etal_split().captures(pre_venue) {
            (extract_authors(group(&c, 1)), Some(group(&c, 2)))
        } else if let Some(c) = re_and_split().captures(pre_venue) {
            (extract_authors(group(&c, 1)), Some(group(&c, 2)))
        } else if let Some(c) = re_author_list().captures(pre_venue) {
            (extract_authors(group(&c, 1)), Some(group(&c, 2)))
        } else if let Some(c) = re_dot_split().captures(pre_venue) {
            (extract_authors(group(&c, 1)), Some(group(&c, 2)))
        } else {
            (Vec::new(), Some(pre_venue))
        };
        let title = title.map(|t| title_cut(t, false));
        // The title is a substring of `text`, so its first occurrence ends where it ends.
        let venue_start = match title {
            Some(t) if !t.is_empty() => text.find(t).map_or(0, |p| p + t.len()),
            _ => 0,
        };
        let (year, suffix) = last_year(&years);
        (
            authors,
            year,
            suffix,
            title.map(str::to_string),
            extract_venue(&text[venue_start..]),
        )
    };

    Some(AnalysisParsedReference {
        authors,
        year,
        year_suffix,
        title: clean_title(title.as_deref()),
        venue,
        ..entry
    })
}

/// Split then parse; fewer than three entries means it was not a bibliography.
#[must_use]
pub fn parse_bibliography(
    lines: &[AnalysisTextLine],
    with_offsets: bool,
) -> Vec<AnalysisParsedReference> {
    let entries = split_bibliography_entries(lines);
    if entries.len() < 3 {
        return Vec::new();
    }
    entries
        .iter()
        .enumerate()
        .filter_map(|(i, entry)| parse_bibliography_entry(entry, (i + 1) as f64, with_offsets))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, page: f64, y: f64) -> AnalysisTextLine {
        AnalysisTextLine {
            page,
            text: text.to_string(),
            x: 72.0,
            y,
            right: 300.0,
            font_size: 9.0,
            bold: false,
            start: 0.0,
            end: text.len() as f64,
        }
    }

    #[test]
    fn numbered_entry_fields() {
        let lines = [line(
            "[1] A. Smith, B. Jones. Title. In Venue, 2020. doi:10.1234/X",
            1.0,
            100.0,
        )];
        let entry = parse_bibliography_entry(&lines, 9.0, true).expect("parses");
        assert_eq!(entry.index, 1.0);
        assert_eq!(entry.label.as_deref(), Some("[1]"));
        assert_eq!(entry.doi.as_deref(), Some("10.1234/x"));
        assert_eq!(entry.year, Some(2020.0));
    }

    #[test]
    fn quoted_title_and_venue() {
        let lines = [line(
            r#"A. Vaswani, N. Shazeer. "Attention is all you need." In NeurIPS, 2017."#,
            1.0,
            100.0,
        )];
        let entry = parse_bibliography_entry(&lines, 1.0, true).expect("parses");
        assert_eq!(entry.title.as_deref(), Some("Attention is all you need"));
        assert_eq!(entry.venue.as_deref(), Some("NeurIPS"));
        assert_eq!(entry.year, Some(2017.0));
        assert!(entry.authors.iter().any(|a| a == "Vaswani"));
    }

    #[test]
    fn numbered_split_keeps_continuations() {
        let lines = [
            line("[1] A. Smith. First.", 1.0, 100.0),
            line("continued here", 1.0, 90.0),
            line("[2] B. Jones. Second.", 1.0, 80.0),
            line("[3] C. Lee. Third.", 1.0, 70.0),
        ];
        let entries = split_numbered_entries(&lines);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].len(), 2);
    }

    #[test]
    fn venue_from_in_clause() {
        assert_eq!(
            extract_venue("In Proceedings of ICML. 2019."),
            Some("Proceedings of ICML".to_string())
        );
    }

    #[test]
    fn label_number_reads_first_set_group() {
        let groups = vec![
            Some("[12]".to_string()),
            Some("[12]".to_string()),
            Some("12".to_string()),
            None,
            None,
            None,
        ];
        assert_eq!(label_number(&groups), 12.0);
    }

    #[test]
    fn fewer_than_three_entries_is_not_a_bibliography() {
        assert!(parse_bibliography(&[line("x", 1.0, 1.0)], true).is_empty());
    }
}

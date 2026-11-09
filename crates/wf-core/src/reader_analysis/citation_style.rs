//! Citation style detection: whether the body cites by `[n]`, by `(Author year)`, or both.
//! A faithful port of `detectCitationStyle` in
//! packages/core/src/features/reader/find-citation-mentions.ts.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use crate::papers::js_regex::{compile, space_class};
use crate::reader_analysis::citations::{LETTER_CLASS, UPPER_CLASS};

/// Which citation convention the body uses (`CitationStyle`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CitationStyle {
    /// `[n]` brackets only.
    Numeric,
    /// `(Author year)` and `Author (year)` only.
    AuthorYear,
    /// Both conventions, as a survey quoting other papers' styles may have.
    Both,
}

/// `[n]` numbers, ranges and lists (`BRACKET_TOKEN`).
static BRACKET_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(&bracket_pattern()).ok());

/// `(Author year)`, with an optional lead-in and a trailing note (`PAREN_AUTHOR_YEAR_TOKEN`).
static PAREN_AUTHOR_YEAR_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(&paren_author_year_pattern()).ok());

/// `Author (year)` and `Author et al. (year)` (`NARRATIVE_TOKEN`).
static NARRATIVE_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(&narrative_pattern()).ok());

/// JS `\s` as a class body, so the patterns match the TS regexes' whitespace.
fn js_space() -> String {
    format!("[{}]", space_class())
}

/// `SURNAME`: capitalised, possibly with a particle, an apostrophe or a hyphen.
fn surname() -> String {
    let s = js_space();
    let upper = UPPER_CLASS.as_str();
    let letter = LETTER_CLASS.as_str();
    format!(
        r"(?:(?:van|von|de|der|den|del|da|di|la|le|du|dos|das|te|ter|al|el|bin|ibn){s}+)*[{upper}][{letter}'\x{{2019}}\x{{2d}}]+"
    )
}

/// `ET_AL`: "et al." and the abbreviations and typos it is set as.
fn et_al() -> String {
    let s = js_space();
    format!(r"(?:et\.?{s}*al\.?|et{s}+alii|and{s}+colleagues|and{s}+others|&{s}+al\.?)")
}

/// `AUTHORS`: one, two, or "A, B, and C" authors, or a leading author with "et al.".
fn authors() -> String {
    let s = js_space();
    let surname = surname();
    let et_al = et_al();
    format!(r"{surname}(?:{s}+{et_al}|(?:,{s}*{surname})*,?{s}+(?:and|&){s}+{surname})?")
}

/// `YEAR`: a 1900s or 2000s year with an optional suffix letter.
const YEAR: &str = r"(?:19|20)\d\d[a-z]?";

/// `LEAD_IN`: an optional "e.g.", "see", "cf." and the like.
fn lead_in() -> String {
    let s = js_space();
    format!(r"(?:(?:e\.g\.|see also|see|cf\.|but see),?{s}+)?")
}

/// `NUMBER_LIST`: the body of a bracketed number list.
fn number_list() -> String {
    let s = js_space();
    format!(
        r"{s}*\d{{1,4}}(?:{s}*[-\x{{2013}}\x{{2014}}]{s}*\d{{1,4}})?(?:{s}*[,;]{s}*\d{{1,4}}(?:{s}*[-\x{{2013}}\x{{2014}}]{s}*\d{{1,4}})?)*{s}*"
    )
}

fn bracket_pattern() -> String {
    format!(r"\[{}\]", number_list())
}

fn paren_author_year_pattern() -> String {
    let s = js_space();
    let lead_in = lead_in();
    let authors = authors();
    format!(r"\({lead_in}{authors},?{s}+{YEAR}[^()]*\)")
}

fn narrative_pattern() -> String {
    let s = js_space();
    let authors = authors();
    format!(r"{authors}{s}+\({YEAR}(?:[,;]{s}*[^()]*)?\)")
}

/// Non-overlapping matches of `re` in `text`; a pattern that failed to compile matches nothing.
fn count(re: &LazyLock<Option<Regex>>, text: &str) -> usize {
    re.as_ref().map_or(0, |re| re.find_iter(text).count())
}

/// Which citation convention the body uses (`detectCitationStyle`).
///
/// Tallies `[n]` against `(Author year)` over every text. A style counts once it has at least
/// two hits and a fifth of all tokens; brackets weigh three times an author-year hit, because a
/// `[3]` is rarely anything else while "(Smith 2019)" also appears in prose. Both can coexist, in
/// which case the result is [`CitationStyle::Both`]. `None` when neither reaches the threshold.
#[must_use]
pub fn detect_citation_style(texts: &[String]) -> Option<CitationStyle> {
    let mut numeric = 0usize;
    let mut author_year = 0usize;
    for text in texts {
        numeric += 3 * count(&BRACKET_RE, text);
        // "Smith (2019)" is author-year evidence too: a paper that cites only narratively
        // would otherwise read as having no style at all.
        author_year += count(&PAREN_AUTHOR_YEAR_RE, text) + count(&NARRATIVE_RE, text);
    }
    let total = (numeric + author_year) as f64;
    let threshold = 2.0_f64.max(total / 5.0);
    let has_numeric = numeric as f64 >= threshold;
    let has_author_year = author_year as f64 >= threshold;
    match (has_numeric, has_author_year) {
        (true, true) => Some(CitationStyle::Both),
        (true, false) => Some(CitationStyle::Numeric),
        (false, true) => Some(CitationStyle::AuthorYear),
        (false, false) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{CitationStyle, detect_citation_style};

    fn texts(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn numeric_brackets_win() {
        assert_eq!(
            detect_citation_style(&texts(&["see [1] and [2, 3]", "then [4]"])),
            Some(CitationStyle::Numeric)
        );
    }

    #[test]
    fn author_year_parentheses_win() {
        assert_eq!(
            detect_citation_style(&texts(&["see (Smith 2019) and (Lee et al. 2020)"])),
            Some(CitationStyle::AuthorYear)
        );
    }

    #[test]
    fn both_conventions_coexist() {
        assert_eq!(
            detect_citation_style(&texts(&[
                "see [1] [2] [3] (Smith 2019) (Lee 2020) (Jones 2021) (Doe 2022)"
            ])),
            Some(CitationStyle::Both)
        );
    }

    #[test]
    fn a_bare_year_is_no_style() {
        assert_eq!(
            detect_citation_style(&texts(&["no citations here (2019)"])),
            None
        );
    }

    #[test]
    fn style_serializes_kebab_case() {
        assert_eq!(
            serde_json::to_string(&CitationStyle::AuthorYear).unwrap(),
            "\"author-year\""
        );
    }
}

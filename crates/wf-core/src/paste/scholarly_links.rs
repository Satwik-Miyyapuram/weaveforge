//! Making a pasted identifier resolvable.
//!
//! A bare DOI or arXiv id cannot be clicked a year later, and search cannot tell
//! it from a version number. Both have one canonical resolver, so linking them
//! needs no network and makes no guess.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::Serialize;

use super::markdown_ranges::{
    frontmatter_range, markdown_code_ranges, markdown_syntax_ranges, math_ranges,
};
use super::text_range::{TextRange, index_ranges};
use crate::papers::js_regex::compile;

/// A DOI: the `10.` registrant prefix, four to nine digits, then a suffix.
/// The lookbehind is checked by hand in `preceded_by` because regex-lite has none.
static DOI: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+").ok());

/// An arXiv id, only ever with its prefix, so bare decimals are not linked.
static ARXIV: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(r"(?i)arXiv:\s?((?:\d{4}\.\d{4,5}(?:v\d+)?)|(?:[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?))")
        .ok()
});

/// A whole inline link or image, label included, so a DOI label is not nested.
static INLINE_LINK: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"!?\[[^\]\n]*\]\([^)\n]*\)").ok());

/// Punctuation that ends the sentence rather than the identifier.
const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?', '\'', '"'];

/// Trims what the greedy suffix pattern swallowed from the prose after it.
/// A closing bracket goes only when the identifier did not open one.
fn trim_identifier(value: &str) -> &str {
    let mut end = value.len();
    while let Some(head) = value.get(..end) {
        let Some(ch) = head.chars().next_back() else {
            break;
        };
        if TRAILING.contains(&ch) {
            end -= 1;
            continue;
        }
        if ch == ')' && head.matches(')').count() > head.matches('(').count() {
            end -= 1;
            continue;
        }
        break;
    }
    value.get(..end).unwrap_or_default()
}

/// True when the character before `start` is one the DOI lookbehind forbids.
fn doi_lookbehind(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '/' | '.' | ':' | '-')
}

/// True when the character before `start` is one the arXiv lookbehind forbids.
fn arxiv_lookbehind(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '/' | ':' | '-')
}

/// True when the character before byte `start` satisfies `forbidden`.
fn preceded_by(text: &str, start: usize, forbidden: fn(char) -> bool) -> bool {
    text.get(..start)
        .and_then(|head| head.chars().next_back())
        .is_some_and(forbidden)
}

/// Every whole inline link or image in `text`.
fn inline_links(text: &str) -> Vec<TextRange> {
    let Some(re) = INLINE_LINK.as_ref() else {
        return Vec::new();
    };
    let mut links = Vec::new();
    let mut pos = 0;
    while let Some(found) = re.find_at(text, pos) {
        links.push(TextRange {
            start: found.start(),
            end: found.end(),
        });
        pos = found.end();
    }
    links
}

/// The result of linking the identifiers in a text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ScholarlyLinkResult {
    /// The text with the identifiers linked.
    pub text: String,
    /// How many identifiers were linked.
    pub count: u32,
}

/// One identifier to replace, with the Markdown that replaces it.
struct Hit {
    start: usize,
    end: usize,
    replacement: String,
}

/// Links every bare DOI and arXiv id in `text`.
///
/// `protect` carries the ranges the caller has already claimed, so a DOI inside
/// `https://doi.org/...` is left exactly as it is.
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn link_scholarly_identifiers(text: &str, protect: &[TextRange]) -> ScholarlyLinkResult {
    let mut protected = protect.to_vec();
    protected.extend(inline_links(text));
    protected.extend(markdown_code_ranges(text));
    protected.extend(math_ranges(text));
    protected.extend(markdown_syntax_ranges(text));
    protected.extend(frontmatter_range(text));
    let ranges = index_ranges(&protected);

    let mut hits: Vec<Hit> = Vec::new();
    if let Some(doi_re) = DOI.as_ref() {
        let mut pos = 0;
        while let Some(found) = doi_re.find_at(text, pos) {
            if preceded_by(text, found.start(), doi_lookbehind) {
                pos = found.start() + 1;
                continue;
            }
            pos = found.end();
            let doi = trim_identifier(found.as_str());
            if !doi.contains('/') {
                continue;
            }
            let start = found.start();
            let end = start + doi.len();
            if ranges.overlaps(start, end) {
                continue;
            }
            hits.push(Hit {
                start,
                end,
                replacement: format!("[{doi}](https://doi.org/{doi})"),
            });
        }
    }

    let doi_claims: Vec<TextRange> = hits
        .iter()
        .map(|hit| TextRange {
            start: hit.start,
            end: hit.end,
        })
        .collect();
    let claimed_dois = index_ranges(&doi_claims);

    if let Some(arxiv_re) = ARXIV.as_ref() {
        let mut pos = 0;
        while let Some(caps) = arxiv_re.captures_at(text, pos) {
            let (Some(whole), Some(ident)) = (caps.get(0), caps.get(1)) else {
                break;
            };
            if preceded_by(text, whole.start(), arxiv_lookbehind) {
                pos = whole.start() + 1;
                continue;
            }
            pos = whole.end();
            let start = whole.start();
            let end = whole.end();
            if ranges.overlaps(start, end) || claimed_dois.overlaps(start, end) {
                continue;
            }
            let ident = ident.as_str();
            hits.push(Hit {
                start,
                end,
                replacement: format!("[arXiv:{ident}](https://arxiv.org/abs/{ident})"),
            });
        }
    }

    if hits.is_empty() {
        return ScholarlyLinkResult {
            text: text.to_string(),
            count: 0,
        };
    }

    hits.sort_by_key(|hit| hit.start);
    let mut out = String::new();
    let mut cursor = 0;
    for hit in &hits {
        out.push_str(text.get(cursor..hit.start).unwrap_or_default());
        out.push_str(&hit.replacement);
        cursor = hit.end;
    }
    out.push_str(text.get(cursor..).unwrap_or_default());

    ScholarlyLinkResult {
        text: out,
        count: u32::try_from(hits.len()).unwrap_or(u32::MAX),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn link(text: &str) -> String {
        link_scholarly_identifiers(text, &[]).text
    }

    #[test]
    fn bare_doi_becomes_a_link_labelled_with_the_identifier() {
        assert_eq!(
            link("See 10.1145/3292500.3330701 for the method."),
            "See [10.1145/3292500.3330701](https://doi.org/10.1145/3292500.3330701) for the method."
        );
    }

    #[test]
    fn sentence_punctuation_is_not_part_of_the_identifier() {
        assert_eq!(
            link("as in 10.1038/nature12373."),
            "as in [10.1038/nature12373](https://doi.org/10.1038/nature12373)."
        );
        assert_eq!(
            link("(see 10.1038/nature12373)"),
            "(see [10.1038/nature12373](https://doi.org/10.1038/nature12373))"
        );
    }

    #[test]
    fn doi_with_balanced_parentheses_keeps_them() {
        let doi = "10.1002/(SICI)1097-0258(19980815)17:15";
        assert_eq!(link(doi), format!("[{doi}](https://doi.org/{doi})"));
    }

    #[test]
    fn arxiv_id_is_linked_only_with_its_prefix() {
        assert_eq!(
            link("arXiv:1706.03762 is the one"),
            "[arXiv:1706.03762](https://arxiv.org/abs/1706.03762) is the one"
        );
        assert_eq!(
            link("arXiv:math.GT/0309136"),
            "[arXiv:math.GT/0309136](https://arxiv.org/abs/math.GT/0309136)"
        );
        assert_eq!(
            link("the value 1706.03762 was measured"),
            "the value 1706.03762 was measured"
        );
    }

    #[test]
    fn identifier_already_inside_a_link_or_url_is_left_alone() {
        for text in [
            "https://doi.org/10.1145/3292500.3330701",
            "[the paper](https://doi.org/10.1145/3292500.3330701)",
            "[10.1145/3292500.3330701](https://doi.org/10.1145/3292500.3330701)",
            "see https://arxiv.org/abs/1706.03762 and arXiv",
        ] {
            assert_eq!(link(text), text, "{text}");
        }
    }

    #[test]
    fn code_maths_and_frontmatter_are_not_touched() {
        for text in [
            "`10.1145/3292500.3330701`",
            "```\n10.1145/3292500.3330701\n```",
            "$10.1145/3292500.3330701$",
            "---\ndoi: 10.1145/3292500.3330701\n---\n\nbody",
        ] {
            assert_eq!(link(text), text, "{text}");
        }
    }

    #[test]
    fn version_number_is_not_a_doi() {
        for text in [
            "10.2/beta",
            "v10.1145/x",
            "/10.1145/3292500",
            "110.1145/3292500",
        ] {
            assert_eq!(link(text), text, "{text}");
        }
    }

    #[test]
    fn several_identifiers_are_linked_and_linking_is_idempotent() {
        let result = link_scholarly_identifiers(
            "10.1038/nature12373 and arXiv:1706.03762 and 10.1145/3292500.3330701",
            &[],
        );
        assert_eq!(result.count, 3);
        assert_eq!(result.text.matches("](https://").count(), 3);
        let once = link("See 10.1038/nature12373 and arXiv:1706.03762.");
        assert_eq!(link(&once), once);
    }

    #[test]
    fn non_ascii_text_and_empty_input_pass_through() {
        assert_eq!(
            link("café 10.1038/nature12373 é"),
            "café [10.1038/nature12373](https://doi.org/10.1038/nature12373) é"
        );
        let empty = link_scholarly_identifiers("", &[]);
        assert_eq!(empty.text, "");
        assert_eq!(empty.count, 0);
    }

    #[test]
    fn every_pattern_compiles() {
        assert!(DOI.is_some(), "DOI");
        assert!(ARXIV.is_some(), "ARXIV");
        assert!(INLINE_LINK.is_some(), "INLINE_LINK");
    }
}

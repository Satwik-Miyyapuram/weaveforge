//! What a paper is called in a bibliography. A faithful port of
//! packages/core/src/features/report/domain/parts.ts.
//!
//! Precedence: a hand-set key, then the BibTeX key, then Better BibTeX's `Citation Key:` line in
//! `extra`, then a key synthesised from the DOI, the arXiv id or the paper id.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use crate::papers::js_regex::{compile, space_class};
use crate::reader_analysis::lines::js_trim;

/// `/@\w+\{([^,\s]+)\s*,/`: the key of the first BibTeX entry.
static BIBTEX_KEY: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(&format!(r"@\w+\{{([^,{}]+)\s*,", space_class())).ok());

/// `/Citation Key:\s*(\S+)/i`: the Better BibTeX key in `extra`.
static EXTRA_KEY: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"(?i)Citation Key:\s*(\S+)").ok());

/// The paper fields cite-key resolution reads. The TS `metadata` keys are flattened to the top.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CiteKeyPaper {
    /// The paper id. The last fallback key is derived from it.
    pub id: String,
    /// `paper.doi`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub doi: Option<String>,
    /// `paper.arxivId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub arxiv_id: Option<String>,
    /// `paper.bibtex`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub bibtex: Option<String>,
    /// `metadata.citeKey`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub cite_key: Option<String>,
    /// `metadata.citationKey`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub citation_key: Option<String>,
    /// `metadata.extra`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub extra: Option<String>,
}

/// Trims JS-style and returns the text only if something is left (JS truthiness of a string).
fn non_blank(value: Option<&str>) -> Option<&str> {
    value.map(js_trim).filter(|s| !s.is_empty())
}

/// The first capture group of `re` in `text`.
fn capture_group<'a>(re: Option<&Regex>, text: &'a str) -> Option<&'a str> {
    re?.captures(text)?.get(1).map(|m| m.as_str())
}

/// Replaces each UTF-16 unit that `keep` rejects with `_`. JS `replace` works per unit, so a
/// non-BMP char becomes two underscores.
fn replace_units(text: &str, keep: impl Fn(char) -> bool) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if keep(c) {
            out.push(c);
        } else {
            for _ in 0..c.len_utf16() {
                out.push('_');
            }
        }
    }
    out
}

/// `replace(/[^A-Za-z0-9_:-]/g, "_")`: the characters BibTeX and biber accept in a key.
fn to_key_safe(text: &str) -> String {
    replace_units(text, |c| {
        c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '-')
    })
}

/// `replace(/[^A-Za-z0-9]/g, "_")`: for identifiers embedded in a synthesised key.
fn to_alnum_underscored(text: &str) -> String {
    replace_units(text, |c| c.is_ascii_alphanumeric())
}

/// `id.replace(/-/g, "").slice(0, 12)`, counted in UTF-16 units. A cut through a surrogate pair
/// becomes U+FFFD, since a Rust `String` cannot hold the lone surrogate JS would keep.
fn paper_id_prefix(id: &str) -> String {
    let units: Vec<u16> = id
        .encode_utf16()
        .filter(|&u| u != u16::from(b'-'))
        .take(12)
        .collect();
    String::from_utf16_lossy(&units)
}

/// A paper's preferred cite key, without uniqueness suffixing.
///
/// Never empty: a paper with no metadata, no BibTeX and no identifier still gets a key derived
/// from its id, because an export that silently omits an entry is worse than an ugly key.
#[must_use]
pub fn resolve_cite_key(paper: &CiteKeyPaper) -> String {
    let from_meta =
        non_blank(paper.cite_key.as_deref()).or_else(|| non_blank(paper.citation_key.as_deref()));
    let from_bib = non_blank(
        paper
            .bibtex
            .as_deref()
            .and_then(|b| capture_group(BIBTEX_KEY.as_ref(), b)),
    );
    let from_extra = non_blank(
        paper
            .extra
            .as_deref()
            .and_then(|e| capture_group(EXTRA_KEY.as_ref(), e)),
    );
    let preferred = from_meta
        .or(from_bib)
        .or(from_extra)
        .map(to_key_safe)
        .unwrap_or_default();
    if !preferred.is_empty() {
        return preferred;
    }
    if let Some(doi) = paper.doi.as_deref().filter(|d| !d.is_empty()) {
        return format!("doi_{}", to_alnum_underscored(doi));
    }
    if let Some(arxiv) = paper.arxiv_id.as_deref().filter(|a| !a.is_empty()) {
        return format!("arxiv_{}", to_alnum_underscored(arxiv));
    }
    format!("paper_{}", paper_id_prefix(&paper.id))
}

/// [`resolve_cite_key`], made unique against `used`. The caller records the returned key, so the
/// second `smith2020` becomes `smith2020_2`.
#[must_use]
pub fn unique_cite_key(paper: &CiteKeyPaper, used: &[String]) -> String {
    let base = resolve_cite_key(paper);
    let mut key = base.clone();
    let mut n = 2_usize;
    while used.contains(&key) {
        key = format!("{base}_{n}");
        n += 1;
    }
    key
}

/// Formats a cite key for insertion. Empty or whitespace keys yield `""`, and so does an unknown
/// `format` (the TS union cannot produce one).
#[must_use]
pub fn format_citation(key: &str, format: &str) -> String {
    let trimmed = to_key_safe(js_trim(key));
    if trimmed.is_empty() {
        return String::new();
    }
    match format {
        "latex" => format!("\\cite{{{trimmed}}}"),
        "pandoc" => format!("[@{trimmed}]"),
        "footnote" => format!("[^{trimmed}]"),
        "raw" => trimmed,
        _ => String::new(),
    }
}

/// [`resolve_cite_key`] then [`format_citation`] in one step.
#[must_use]
pub fn format_paper_citation(paper: &CiteKeyPaper, format: &str) -> String {
    format_citation(&resolve_cite_key(paper), format)
}

#[cfg(test)]
mod tests {
    use super::{
        CiteKeyPaper, format_citation, format_paper_citation, resolve_cite_key, unique_cite_key,
    };

    fn paper(id: &str) -> CiteKeyPaper {
        CiteKeyPaper {
            id: id.to_owned(),
            ..CiteKeyPaper::default()
        }
    }

    #[test]
    fn hand_set_key_beats_bibtex() {
        let p = CiteKeyPaper {
            cite_key: Some("mine".to_owned()),
            bibtex: Some("@article{other,".to_owned()),
            ..paper("p")
        };
        assert_eq!(resolve_cite_key(&p), "mine");
    }

    #[test]
    fn blank_meta_falls_through_and_bibtex_key_is_used() {
        let blank = CiteKeyPaper {
            cite_key: Some("  ".to_owned()),
            citation_key: Some("alpha".to_owned()),
            ..paper("p")
        };
        assert_eq!(resolve_cite_key(&blank), "alpha");

        let bib = CiteKeyPaper {
            bibtex: Some("@article{Smith2020,\n  title={x}\n}".to_owned()),
            ..paper("p")
        };
        assert_eq!(resolve_cite_key(&bib), "Smith2020");
    }

    #[test]
    fn extra_citation_key_line_is_read_case_insensitively() {
        let p = CiteKeyPaper {
            extra: Some("Original date: 2021\ncitation key: wang2021\n".to_owned()),
            ..paper("p")
        };
        assert_eq!(resolve_cite_key(&p), "wang2021");
    }

    #[test]
    fn doi_then_arxiv_then_paper_id_fallbacks() {
        let doi = CiteKeyPaper {
            doi: Some("10.1/ab-c".to_owned()),
            arxiv_id: Some("2401.00001".to_owned()),
            ..paper("p")
        };
        assert_eq!(resolve_cite_key(&doi), "doi_10_1_ab_c");

        let arxiv = CiteKeyPaper {
            doi: Some(String::new()),
            arxiv_id: Some("2401.00001v2".to_owned()),
            ..paper("p")
        };
        assert_eq!(resolve_cite_key(&arxiv), "arxiv_2401_00001v2");

        let id = paper("123e4567-e89b-12d3-a456-426614174000");
        assert_eq!(resolve_cite_key(&id), "paper_123e4567e89b");
    }

    #[test]
    fn unique_key_suffixes_past_taken_keys() {
        let p = CiteKeyPaper {
            cite_key: Some("smith2020".to_owned()),
            ..paper("p")
        };
        assert_eq!(unique_cite_key(&p, &[]), "smith2020");
        let used = ["smith2020".to_owned(), "smith2020_2".to_owned()];
        assert_eq!(unique_cite_key(&p, &used), "smith2020_3");
    }

    #[test]
    fn each_format_wraps_the_safe_key() {
        assert_eq!(format_citation("a:b", "latex"), "\\cite{a:b}");
        assert_eq!(format_citation("a:b", "pandoc"), "[@a:b]");
        assert_eq!(format_citation("a:b", "footnote"), "[^a:b]");
        assert_eq!(format_citation("a:b", "raw"), "a:b");
        assert_eq!(format_citation("  a b  ", "raw"), "a_b");
        assert_eq!(format_citation("a\u{1F600}", "raw"), "a__");
    }

    #[test]
    fn empty_key_formats_to_empty_string() {
        assert_eq!(format_citation("   ", "latex"), "");
        assert_eq!(
            format_paper_citation(&CiteKeyPaper::default(), "raw"),
            "paper_"
        );
    }
}

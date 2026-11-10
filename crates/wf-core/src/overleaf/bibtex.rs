//! The BibTeX half of the Overleaf export: cite keys for the LaTeX body, the keys the body
//! actually cites, and one `references.bib` entry per paper. A faithful port of
//! apps/web/src/features/overleaf/application/bibtex-export.ts.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

use crate::papers::js_regex::compile;
use crate::reader_analysis::lines::js_trim;
use crate::report::cite_key::{self, CiteKeyPaper};

/// The paper fields a `.bib` entry reads. The cite-key fields are the `metadata` keys the TS side
/// flattens to the top.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BibPaper {
    /// `paper.id`.
    pub id: String,
    /// `paper.title`.
    pub title: String,
    /// `paper.authors`.
    #[serde(default)]
    pub authors: Vec<String>,
    /// `paper.year`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub year: Option<i32>,
    /// `paper.venue`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub venue: Option<String>,
    /// `paper.doi`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub doi: Option<String>,
    /// `paper.arxivId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub arxiv_id: Option<String>,
    /// `paper.url`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub url: Option<String>,
    /// `paper.bibtex`: a stored entry, reused with its key replaced.
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

/// `/\\cite\{([^}]*)\}/g`: one `\cite{...}` command, its key list in group 1.
static CITE_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"\\cite\{([^}]*)\}").ok());

/// `/@(\w+)\{[^,]+,/`: the entry head, whose key is replaced.
static ENTRY_HEAD_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"@(\w+)\{[^,]+,").ok());

/// Venues that mean a proceedings entry rather than a journal one.
static PROCEEDINGS_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(
        r"(?i)\b(proceedings|conference|conf\.?|workshop|symposium|congress|meeting)\b|\b(neurips|nips|icml|iclr|cvpr|iccv|eccv|aaai|ijcai|acl|emnlp|naacl|coling|sigir|kdd|www|chi|uist|siggraph|interspeech|icassp|miccai)\b",
    )
    .ok()
});

/// Non-empty after JS trimming, or `None`.
fn non_blank(value: Option<&str>) -> Option<&str> {
    value.map(js_trim).filter(|s| !s.is_empty())
}

/// Escape a value for a braced BibTeX field.
///
/// Unescaped `&`, `%`, `#`, `_` and `$` break an Overleaf bibliography. Braces are left alone when
/// balanced (Zotero's `{BERT}` protects capitalisation), and escaped when unbalanced.
fn escape_bib_field(value: &str) -> String {
    let mut depth: i64 = 0;
    let mut balanced = true;
    for ch in value.chars() {
        if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth < 0 {
                balanced = false;
                break;
            }
        }
    }
    if depth != 0 {
        balanced = false;
    }

    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\textbackslash{}"),
            '~' => out.push_str("\\textasciitilde{}"),
            '^' => out.push_str("\\textasciicircum{}"),
            '&' | '%' | '#' | '_' | '$' => {
                out.push('\\');
                out.push(ch);
            }
            '{' | '}' if !balanced => {
                out.push('\\');
                out.push(ch);
            }
            other => out.push(other),
        }
    }
    out
}

/// Cite keys the generated LaTeX body references, in first-appearance order and without repeats.
/// Read back off the LaTeX, so it stays correct however a citation came to be emitted.
#[must_use]
pub fn collect_cited_keys(latex: &str) -> Vec<String> {
    let mut keys: Vec<String> = Vec::new();
    let Some(re) = CITE_RE.as_ref() else {
        return keys;
    };
    for caps in re.captures_iter(latex) {
        let list = caps.get(1).map_or("", |m| m.as_str());
        for raw in list.split(',') {
            let key = js_trim(raw);
            if !key.is_empty() && !keys.iter().any(|k| k == key) {
                keys.push(key.to_owned());
            }
        }
    }
    keys
}

/// Entry type from the venue: a proceedings venue is `@inproceedings` with `booktitle`, any other
/// venue is `@article` with `journal`, and no venue is an `@misc` preprint.
fn bib_entry_shape(venue: Option<&str>) -> (&'static str, Option<&'static str>) {
    match venue {
        Some(v) if PROCEEDINGS_RE.as_ref().is_some_and(|re| re.is_match(v)) => {
            ("inproceedings", Some("booktitle"))
        }
        Some(_) => ("article", Some("journal")),
        None => ("misc", None),
    }
}

/// `arxiv:` prefix dropped, case-insensitively, the way `/^arxiv:/i` strips it.
fn strip_arxiv_prefix(id: &str) -> &str {
    match id.get(..6) {
        Some(prefix) if prefix.eq_ignore_ascii_case("arxiv:") => &id[6..],
        _ => id,
    }
}

/// Stored entry with its key replaced by `key`. The entry is unchanged if its head does not parse.
fn with_key(bibtex: &str, key: &str) -> String {
    match ENTRY_HEAD_RE.as_ref() {
        Some(re) => re
            .replace(bibtex, |caps: &regex_lite::Captures| {
                format!("@{}{{{key},", &caps[1])
            })
            .into_owned(),
        None => bibtex.to_owned(),
    }
}

/// One `.bib` entry for `paper`, under `key`.
#[must_use]
pub fn paper_to_bibtex(paper: &BibPaper, key: &str) -> String {
    if let Some(stored) = paper.bibtex.as_deref().filter(|b| !js_trim(b).is_empty()) {
        return with_key(stored, key);
    }
    let authors = if paper.authors.is_empty() {
        "Unknown".to_owned()
    } else {
        paper.authors.join(" and ")
    };
    let venue = non_blank(paper.venue.as_deref());
    let (entry_type, venue_field) = bib_entry_shape(venue);
    let arxiv_id = non_blank(paper.arxiv_id.as_deref())
        .map(strip_arxiv_prefix)
        .filter(|s| !s.is_empty());
    // `url` and `doi` are verbatim fields in biblatex, so they are trimmed and otherwise untouched.
    let url = non_blank(paper.url.as_deref())
        .map(str::to_owned)
        .or_else(|| arxiv_id.map(|id| format!("https://arxiv.org/abs/{id}")));

    let mut fields: Vec<String> = vec![
        format!("  title = {{{}}}", escape_bib_field(&paper.title)),
        format!("  author = {{{}}}", escape_bib_field(&authors)),
    ];
    if let Some(year) = paper.year {
        fields.push(format!("  year = {{{year}}}"));
    }
    if let (Some(v), Some(field)) = (venue, venue_field) {
        fields.push(format!("  {field} = {{{}}}", escape_bib_field(v)));
    }
    if let Some(doi) = non_blank(paper.doi.as_deref()) {
        fields.push(format!("  doi = {{{doi}}}"));
    }
    if let Some(url) = url {
        fields.push(format!("  url = {{{url}}}"));
    }
    // biblatex renders arXiv identifiers properly only with all three.
    if let Some(id) = arxiv_id {
        fields.push(format!("  eprint = {{{id}}}"));
        fields.push("  eprinttype = {arxiv}".to_owned());
        fields.push("  archivePrefix = {arXiv}".to_owned());
    }
    if entry_type == "misc" && venue.is_none() {
        fields.push("  howpublished = {Preprint}".to_owned());
    }
    format!("@{entry_type}{{{key},\n{}\n}}", fields.join(",\n"))
}

/// The paper fields a cite key reads.
fn cite_paper(paper: &BibPaper) -> CiteKeyPaper {
    CiteKeyPaper {
        id: paper.id.clone(),
        doi: paper.doi.clone(),
        arxiv_id: paper.arxiv_id.clone(),
        bibtex: paper.bibtex.clone(),
        cite_key: paper.cite_key.clone(),
        citation_key: paper.citation_key.clone(),
        extra: paper.extra.clone(),
    }
}

/// The cite key of each paper, in order, each made unique against the keys before it.
#[must_use]
pub fn paper_cite_keys(papers: &[BibPaper]) -> Vec<String> {
    let mut used: Vec<String> = Vec::with_capacity(papers.len());
    for paper in papers {
        let key = cite_key::unique_cite_key(&cite_paper(paper), &used);
        used.push(key);
    }
    used
}

/// The `.bib` text for entries already rendered, one blank line apart. `% (empty)` when none.
#[must_use]
pub fn join_bibtex(entries: &[String]) -> String {
    if entries.is_empty() {
        "% (empty)\n".to_owned()
    } else {
        format!("{}\n", entries.join("\n\n"))
    }
}

/// The whole library as one `.bib`, with the keys the export gives each paper.
#[must_use]
pub fn library_bibtex(papers: &[BibPaper]) -> String {
    let keys = paper_cite_keys(papers);
    let entries: Vec<String> = papers
        .iter()
        .zip(&keys)
        .map(|(paper, key)| paper_to_bibtex(paper, key))
        .collect();
    join_bibtex(&entries)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn paper(id: &str, title: &str) -> BibPaper {
        BibPaper {
            id: id.to_owned(),
            title: title.to_owned(),
            authors: vec!["Ada Lovelace".to_owned()],
            ..BibPaper::default()
        }
    }

    #[test]
    fn escapes_special_characters_but_keeps_balanced_braces() {
        assert_eq!(escape_bib_field("Cost & Benefit"), "Cost \\& Benefit");
        assert_eq!(
            escape_bib_field("100% #1 a_b $x$"),
            "100\\% \\#1 a\\_b \\$x\\$"
        );
        assert_eq!(
            escape_bib_field("a\\b ~c ^d"),
            "a\\textbackslash{}b \\textasciitilde{}c \\textasciicircum{}d"
        );
        assert_eq!(escape_bib_field("{BERT} model"), "{BERT} model");
        assert_eq!(escape_bib_field("a } b"), "a \\} b");
        assert_eq!(escape_bib_field("a { b"), "a \\{ b");
    }

    #[test]
    fn collects_cited_keys_in_order_without_repeats() {
        let keys = collect_cited_keys("text \\cite{a, b} more \\cite{c} and \\cite{a}");
        assert_eq!(keys, vec!["a", "b", "c"]);
        assert!(collect_cited_keys("no cites").is_empty());
    }

    #[test]
    fn picks_entry_type_from_venue() {
        assert_eq!(
            bib_entry_shape(Some("NeurIPS 2024")),
            ("inproceedings", Some("booktitle"))
        );
        assert_eq!(
            bib_entry_shape(Some("Nature")),
            ("article", Some("journal"))
        );
        assert_eq!(bib_entry_shape(None), ("misc", None));
    }

    #[test]
    fn preprint_gets_arxiv_fields_and_howpublished() {
        let mut p = paper("1", "Title");
        p.year = Some(2020);
        p.arxiv_id = Some("arXiv:2001.00001".to_owned());
        assert_eq!(
            paper_to_bibtex(&p, "lovelace2020"),
            "@misc{lovelace2020,\n  title = {Title},\n  author = {Ada Lovelace},\n  year = {2020},\n  url = {https://arxiv.org/abs/2001.00001},\n  eprint = {2001.00001},\n  eprinttype = {arxiv},\n  archivePrefix = {arXiv},\n  howpublished = {Preprint}\n}"
        );
    }

    #[test]
    fn stored_entry_keeps_body_and_takes_new_key() {
        let mut p = paper("1", "Ignored");
        p.bibtex = Some("@article{old,\n  title = {X}\n}".to_owned());
        assert_eq!(
            paper_to_bibtex(&p, "new2020"),
            "@article{new2020,\n  title = {X}\n}"
        );
    }

    #[test]
    fn journal_entry_uses_journal_field_and_doi() {
        let mut p = paper("1", "T");
        p.venue = Some(" Nature ".to_owned());
        p.doi = Some(" 10.1/x ".to_owned());
        let bib = paper_to_bibtex(&p, "k");
        assert!(bib.starts_with("@article{k,\n"));
        assert!(bib.contains("  journal = {Nature}"));
        assert!(bib.contains("  doi = {10.1/x}"));
        assert!(!bib.contains("howpublished"));
    }

    #[test]
    fn library_keys_are_unique_and_empty_library_is_marked() {
        let papers = vec![paper("a", "T"), paper("b", "T")];
        let keys = paper_cite_keys(&papers);
        assert_eq!(keys.len(), 2);
        assert_ne!(keys[0], keys[1]);
        assert_eq!(join_bibtex(&[]), "% (empty)\n");
        assert!(library_bibtex(&papers).contains("@misc{"));
    }
}

//! Which library paper a citation reference points at (TS `LinkCitationsUseCase.forAll` index and
//! lookup in `packages/core/src/features/relations/application/parts.ts`).
//!
//! An arXiv reference matches by the raw arXiv id; a DOI reference matches by its normalised DOI,
//! falling back to the raw value. A reference that points at the paper itself matches nothing. The
//! caller creates the edges and counts failures.

use std::collections::HashMap;

use serde::Deserialize;

use crate::papers::paper::normalize_doi;
use crate::papers::paper_ref::{PaperRef, PaperRefKind};

/// A library paper's identifiers, as the match reads them.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    /// The paper's id, to spot a reference to the paper itself.
    pub id: String,
    /// The raw arXiv id, when stored.
    #[serde(default)]
    pub arxiv_id: Option<String>,
    /// The raw DOI, when stored.
    #[serde(default)]
    pub doi: Option<String>,
}

/// For each paper's references (aligned to `library`), the index of the library paper each
/// reference matches, or `None` when it matches none or only the paper itself. A paper with no
/// references (`None`) yields an empty list.
///
/// When two library papers share a key, the later one wins, as the TS index did.
#[must_use]
pub fn match_references(
    library: &[LibraryEntry],
    references: &[Option<Vec<PaperRef>>],
) -> Vec<Vec<Option<usize>>> {
    let mut by_arxiv: HashMap<&str, usize> = HashMap::new();
    let mut by_doi: HashMap<String, usize> = HashMap::new();
    for (index, paper) in library.iter().enumerate() {
        if let Some(arxiv) = paper.arxiv_id.as_deref().filter(|id| !id.is_empty()) {
            let _ = by_arxiv.insert(arxiv, index);
        }
        if let Some(doi) = normalize_doi(paper.doi.as_deref()) {
            let _ = by_doi.insert(doi, index);
        }
    }
    library
        .iter()
        .enumerate()
        .map(|(index, paper)| {
            references
                .get(index)
                .and_then(Option::as_ref)
                .map(|cites| {
                    cites
                        .iter()
                        .map(|cited| {
                            let found = match cited.kind {
                                PaperRefKind::Arxiv => by_arxiv.get(cited.value.as_str()).copied(),
                                PaperRefKind::Doi => {
                                    let key = normalize_doi(Some(cited.value.as_str()))
                                        .unwrap_or_else(|| cited.value.clone());
                                    by_doi.get(&key).copied()
                                }
                                PaperRefKind::Url
                                | PaperRefKind::Zotero
                                | PaperRefKind::Bibliographic => None,
                            };
                            found.filter(|&matched| library[matched].id != paper.id)
                        })
                        .collect()
                })
                .unwrap_or_default()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, arxiv: Option<&str>, doi: Option<&str>) -> LibraryEntry {
        LibraryEntry {
            id: id.to_owned(),
            arxiv_id: arxiv.map(str::to_owned),
            doi: doi.map(str::to_owned),
        }
    }

    fn cite(kind: PaperRefKind, value: &str) -> PaperRef {
        PaperRef {
            kind,
            value: value.to_owned(),
        }
    }

    // it: "an arXiv reference matches the library paper with that arXiv id"
    #[test]
    fn an_arxiv_reference_matches_by_arxiv_id() {
        let library = [entry("a", None, None), entry("b", Some("2305.12345"), None)];
        let refs = [Some(vec![cite(PaperRefKind::Arxiv, "2305.12345")]), None];
        assert_eq!(
            match_references(&library, &refs),
            vec![vec![Some(1)], vec![]]
        );
    }

    // it: "a DOI reference matches by normalised DOI"
    #[test]
    fn a_doi_reference_matches_by_normalised_doi() {
        let library = [
            entry("a", None, Some("https://doi.org/10.1145/ABC")),
            entry("b", None, None),
        ];
        let refs = [
            None,
            Some(vec![
                cite(PaperRefKind::Doi, "10.1145/abc"),
                cite(PaperRefKind::Doi, "10.9999/other"),
            ]),
        ];
        assert_eq!(
            match_references(&library, &refs),
            vec![vec![], vec![Some(0), None]]
        );
    }

    // it: "a reference to the paper itself and an unmatched URL both match nothing"
    #[test]
    fn self_references_and_urls_match_nothing() {
        let library = [entry("a", Some("2305.12345"), None)];
        let refs = [Some(vec![
            cite(PaperRefKind::Arxiv, "2305.12345"),
            cite(PaperRefKind::Url, "https://example.org"),
            cite(PaperRefKind::Zotero, "ABCD1234"),
        ])];
        assert_eq!(
            match_references(&library, &refs),
            vec![vec![None, None, None]]
        );
    }

    // it: "when two library papers share an arXiv id the later one wins, as in the TS index"
    #[test]
    fn a_shared_key_resolves_to_the_later_paper() {
        let library = [
            entry("a", Some("2305.12345"), None),
            entry("b", Some("2305.12345"), None),
            entry("c", None, None),
        ];
        let refs = [
            None,
            None,
            Some(vec![cite(PaperRefKind::Arxiv, "2305.12345")]),
        ];
        assert_eq!(match_references(&library, &refs)[2], vec![Some(1)]);
    }
}

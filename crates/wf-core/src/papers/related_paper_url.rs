//! The page a related-paper hit links to (TS `resolveRelatedPaperUrl` in
//! `features/papers/application/fetch-related-papers.ts`). Pure: no I/O.

use super::paper::normalize_doi;

/// The hit's own page when it has one, else its DOI resolver link, else its arXiv abstract
/// page. `None` when the hit has none of them.
#[must_use]
pub fn resolve_related_paper_url(
    url: Option<&str>,
    doi: Option<&str>,
    arxiv_id: Option<&str>,
) -> Option<String> {
    if let Some(url) = url.map(str::trim).filter(|url| !url.is_empty()) {
        return Some(url.to_owned());
    }
    if let Some(doi) = normalize_doi(doi) {
        return Some(format!("https://doi.org/{doi}"));
    }
    arxiv_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(|id| format!("https://arxiv.org/abs/{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_url_then_doi_then_arxiv() {
        assert_eq!(
            resolve_related_paper_url(
                Some(" https://example.com/p "),
                Some("10.1/x"),
                Some("2301.1")
            ),
            Some("https://example.com/p".to_owned())
        );
        assert_eq!(
            resolve_related_paper_url(None, Some("https://doi.org/10.1145/3592979"), None),
            Some("https://doi.org/10.1145/3592979".to_owned())
        );
        assert_eq!(
            resolve_related_paper_url(Some("  "), None, Some("2305.12345")),
            Some("https://arxiv.org/abs/2305.12345".to_owned())
        );
        assert_eq!(resolve_related_paper_url(None, None, None), None);
    }
}

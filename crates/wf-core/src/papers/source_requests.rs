//! Request URLs for the paper metadata sources (arXiv, Crossref, Semantic Scholar).
//!
//! The fetches stay in TypeScript; these builders are the pure part.

use crate::overleaf_workshop::encode_uri_component;

/// Fields asked of Semantic Scholar on every paper lookup.
pub const SEMANTIC_SCHOLAR_FIELDS: &str = "title,authors,year,venue,externalIds,openAccessPdf,citationCount";

/// `${base}?id_list=${encodeURIComponent(id)}` for arXiv's API.
#[must_use]
pub fn arxiv_query_url(base: &str, id: &str) -> String {
    format!("{base}?id_list={}", encode_uri_component(id))
}

/// `${base}/${encodeURIComponent(doi)}` for Crossref's works API.
#[must_use]
pub fn crossref_work_url(base: &str, doi: &str) -> String {
    format!("{base}/{}", encode_uri_component(doi))
}

/// Semantic Scholar's identifier endpoint, `${base}/paper/${kind}:${value}?fields=...`.
/// `kind` is `DOI` or `arXiv`.
#[must_use]
pub fn semantic_scholar_identifier_url(base: &str, kind: &str, value: &str) -> String {
    format!(
        "{base}/paper/{kind}:{}?fields={SEMANTIC_SCHOLAR_FIELDS}",
        encode_uri_component(value)
    )
}

/// Semantic Scholar's title match endpoint, `${base}/paper/search/match?<form query>`.
/// The query string is `URLSearchParams` form encoding, not `encodeURIComponent`.
#[must_use]
pub fn semantic_scholar_match_url(base: &str, query: &str) -> String {
    format!(
        "{base}/paper/search/match?{}",
        form_urlencode(&[("query", query), ("fields", SEMANTIC_SCHOLAR_FIELDS)])
    )
}

/// `application/x-www-form-urlencoded` the way `URLSearchParams.toString()` writes it:
/// ASCII letters, digits and `*-._` stay, a space is `+`, everything else is `%XX`.
#[must_use]
pub fn form_urlencode(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", form_component(k), form_component(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn form_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                out.push(char::from(byte));
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        arxiv_query_url, crossref_work_url, form_urlencode, semantic_scholar_identifier_url,
        semantic_scholar_match_url,
    };

    // it: "a known id is parsed from its entry"
    #[test]
    fn arxiv_url_encodes_the_id() {
        assert_eq!(
            arxiv_query_url("https://export.arxiv.org/api/query", "1706.03762"),
            "https://export.arxiv.org/api/query?id_list=1706.03762"
        );
    }

    #[test]
    fn crossref_url_encodes_the_doi() {
        assert_eq!(
            crossref_work_url("https://api.crossref.org/works", "10.5555/3295222.3295349"),
            "https://api.crossref.org/works/10.5555%2F3295222.3295349"
        );
    }

    // it: "a DOI resolves through the paper/DOI: endpoint and maps identifiers"
    #[test]
    fn semantic_scholar_doi_uses_the_doi_endpoint() {
        let url = semantic_scholar_identifier_url("https://api.semanticscholar.org/graph/v1", "DOI", "10.5555/3295222.3295349");
        assert!(url.starts_with("https://api.semanticscholar.org/graph/v1/paper/DOI:10.5555%2F3295222.3295349?fields="));
    }

    // it: "an arXiv id resolves through the paper/arXiv: endpoint"
    #[test]
    fn semantic_scholar_arxiv_uses_the_arxiv_endpoint() {
        let url = semantic_scholar_identifier_url("https://api.semanticscholar.org/graph/v1", "arXiv", "1706.03762");
        assert!(url.starts_with("https://api.semanticscholar.org/graph/v1/paper/arXiv:1706.03762?fields="));
    }

    // it: "bibliographic refs keep using the match endpoint with similarity gating"
    #[test]
    fn semantic_scholar_match_uses_form_encoding() {
        let url = semantic_scholar_match_url("https://api.semanticscholar.org/graph/v1", "attention is all*you need");
        assert!(url.starts_with(
            "https://api.semanticscholar.org/graph/v1/paper/search/match?query=attention+is+all*you+need&fields=title"
        ));
    }

    #[test]
    fn form_urlencode_escapes_reserved_characters() {
        assert_eq!(form_urlencode(&[("q", "a&b=c/d~e")]), "q=a%26b%3Dc%2Fd%7Ee");
    }
}

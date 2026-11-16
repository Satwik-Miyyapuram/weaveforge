//! Request URLs for the paper metadata sources (wf-core `papers::source_requests`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::source_requests;

/// [`arxiv_query_url`](source_requests::arxiv_query_url) (TS `ArxivMetadataSource.fetch`).
#[wasm_bindgen(js_name = arxivQueryUrl)]
pub fn arxiv_query_url_js(base: &str, id: &str) -> String {
    source_requests::arxiv_query_url(base, id)
}

/// [`crossref_work_url`](source_requests::crossref_work_url) (TS `CrossrefMetadataSource.fetch`).
#[wasm_bindgen(js_name = crossrefWorkUrl)]
pub fn crossref_work_url_js(base: &str, doi: &str) -> String {
    source_requests::crossref_work_url(base, doi)
}

/// [`semantic_scholar_identifier_url`](source_requests::semantic_scholar_identifier_url) (TS `SemanticScholarMetadataSource`, DOI and arXiv).
#[wasm_bindgen(js_name = semanticScholarIdentifierUrl)]
pub fn semantic_scholar_identifier_url_js(base: &str, kind: &str, value: &str) -> String {
    source_requests::semantic_scholar_identifier_url(base, kind, value)
}

/// [`semantic_scholar_match_url`](source_requests::semantic_scholar_match_url) (TS `SemanticScholarMetadataSource`, title match).
#[wasm_bindgen(js_name = semanticScholarMatchUrl)]
pub fn semantic_scholar_match_url_js(base: &str, query: &str) -> String {
    source_requests::semantic_scholar_match_url(base, query)
}

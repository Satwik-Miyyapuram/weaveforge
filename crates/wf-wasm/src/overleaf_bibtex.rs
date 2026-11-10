//! Overleaf BibTeX export helpers (wf-core `overleaf::bibtex`). The TS wrappers in
//! `packages/wf-wasm/src/overleaf-bibtex.ts` flatten a `Paper` before it crosses.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::overleaf::bibtex::{self, BibPaper};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Reads a JS array of papers into the Rust paper list.
fn papers(value: JsValue) -> JsResult<Vec<BibPaper>> {
    serde_wasm_bindgen::from_value(value)
}

/// [`paper_cite_keys`](bibtex::paper_cite_keys) (TS `buildCiteByTitle`'s key list): one key per
/// paper, in order, unique across the list.
///
/// # Errors
///
/// Fails if `papers` is not an array of paper objects.
#[wasm_bindgen(js_name = paperCiteKeys)]
pub fn paper_cite_keys_js(papers_value: JsValue) -> JsResult<JsValue> {
    to_js(&bibtex::paper_cite_keys(&papers(papers_value)?))
}

/// [`collect_cited_keys`](bibtex::collect_cited_keys): the keys a LaTeX body cites, as an array.
#[wasm_bindgen(js_name = collectCitedKeys)]
pub fn collect_cited_keys_js(latex: &str) -> JsResult<JsValue> {
    to_js(&bibtex::collect_cited_keys(latex))
}

/// [`paper_to_bibtex`](bibtex::paper_to_bibtex): one `.bib` entry under `key`.
///
/// # Errors
///
/// Fails if `paper` is not a paper object.
#[wasm_bindgen(js_name = paperToBibtex)]
pub fn paper_to_bibtex_js(paper: JsValue, key: &str) -> JsResult<String> {
    let paper: BibPaper = serde_wasm_bindgen::from_value(paper)?;
    Ok(bibtex::paper_to_bibtex(&paper, key))
}

/// [`join_bibtex`](bibtex::join_bibtex): entries joined with a blank line, or `% (empty)`.
///
/// # Errors
///
/// Fails if `entries` is not an array of strings.
#[wasm_bindgen(js_name = joinBibtex)]
pub fn join_bibtex_js(entries: JsValue) -> JsResult<String> {
    let entries: Vec<String> = serde_wasm_bindgen::from_value(entries)?;
    Ok(bibtex::join_bibtex(&entries))
}

/// [`library_bibtex`](bibtex::library_bibtex): the whole library as one `.bib`.
///
/// # Errors
///
/// Fails if `papers` is not an array of paper objects.
#[wasm_bindgen(js_name = libraryBibtex)]
pub fn library_bibtex_js(papers_value: JsValue) -> JsResult<String> {
    Ok(bibtex::library_bibtex(&papers(papers_value)?))
}

//! Metadata-source response mapping (wf-core `papers::metadata_mapping`). The TS wrappers in
//! `packages/wf-wasm/src/papers-metadata-mapping.ts` re-export the generated types.

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned values"
)]
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::metadata_mapping::{
    CrossrefMessage, OpenAlexWork, SemanticScholarPaper, UrlMetaResponse, arxiv_entry_to_metadata,
    crossref_to_metadata, openalex_to_metadata, semantic_scholar_to_metadata, url_meta_to_metadata,
};

use super::to_js;

fn from_js<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

fn out<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    to_js(value).map_err(|error| JsError::new(&error.to_string()))
}

/// [`crossref_to_metadata`] (TS `crossrefToMetadata`). A Crossref `message` as a paper.
///
/// # Errors
///
/// Fails if `message` is not a Crossref message.
#[wasm_bindgen(js_name = crossrefToMetadata, unchecked_return_type = "B.ZoteroPaperInput")]
pub fn crossref_to_metadata_js(
    #[wasm_bindgen(unchecked_param_type = "B.CrossrefMessage")] message: JsValue,
    doi: String,
) -> Result<JsValue, JsError> {
    let message: CrossrefMessage = from_js(message)?;
    out(&crossref_to_metadata(&message, &doi))
}

/// [`semantic_scholar_to_metadata`] (TS `semanticScholarToMetadata`). A Semantic Scholar paper
/// as a paper.
///
/// # Errors
///
/// Fails if `paper` is not a Semantic Scholar paper.
#[wasm_bindgen(js_name = semanticScholarToMetadata, unchecked_return_type = "B.ZoteroPaperInput")]
pub fn semantic_scholar_to_metadata_js(
    #[wasm_bindgen(unchecked_param_type = "B.SemanticScholarPaper")] paper: JsValue,
) -> Result<JsValue, JsError> {
    let paper: SemanticScholarPaper = from_js(paper)?;
    out(&semantic_scholar_to_metadata(&paper))
}

/// [`openalex_to_metadata`] (TS `openAlexToMetadata`). An OpenAlex work as a paper.
///
/// # Errors
///
/// Fails if `work` is not an OpenAlex work.
#[wasm_bindgen(js_name = openAlexToMetadata, unchecked_return_type = "B.ZoteroPaperInput")]
pub fn open_alex_to_metadata_js(
    #[wasm_bindgen(unchecked_param_type = "B.OpenAlexWork")] work: JsValue,
) -> Result<JsValue, JsError> {
    let work: OpenAlexWork = from_js(work)?;
    out(&openalex_to_metadata(&work))
}

/// [`arxiv_entry_to_metadata`] (TS `arxivEntryToMetadata`). The first entry of an arXiv Atom
/// feed as a paper.
///
/// # Errors
///
/// Fails when the feed has no usable entry for `arxiv_id`.
#[wasm_bindgen(js_name = arxivEntryToMetadata, unchecked_return_type = "B.ZoteroPaperInput")]
pub fn arxiv_entry_to_metadata_js(xml: String, arxiv_id: String) -> Result<JsValue, JsError> {
    let paper = arxiv_entry_to_metadata(&xml, &arxiv_id).map_err(|e| JsError::new(&e))?;
    out(&paper)
}

/// [`url_meta_to_metadata`] (TS `urlMetaToMetadata`). A page's own metadata as a paper.
///
/// # Errors
///
/// Fails when the page has no title, or its title names the page rather than a paper.
#[wasm_bindgen(js_name = urlMetaToMetadata, unchecked_return_type = "B.ZoteroPaperInput")]
pub fn url_meta_to_metadata_js(
    #[wasm_bindgen(unchecked_param_type = "B.UrlMetaResponse")] meta: JsValue,
) -> Result<JsValue, JsError> {
    let meta: UrlMetaResponse = from_js(meta)?;
    let paper = url_meta_to_metadata(&meta).map_err(|e| JsError::new(&e))?;
    out(&paper)
}

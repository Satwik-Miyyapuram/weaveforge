//! Search-document projections for JavaScript (wf-core `search::search_document`).
//! The JS names match `packages/core/src/search/search-document.ts`,
//! `pdf-search-document.ts` and `annotation-search-document.ts`.

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned values"
)]
use std::collections::HashMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::search_document::{self, AnnotationSource, PdfIndexSource, SearchDoc};
use wf_core::sync::workspace_snapshot::WorkspaceSnapshot;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`to_search_docs`](search_document::to_search_docs). `degrees` is a plain
/// `{ "kind:id": count }` object.
///
/// # Errors
///
/// Fails if `snapshot` or `degrees` do not match the expected shape.
#[wasm_bindgen(js_name = toSearchDocs)]
pub fn to_search_docs_js(snapshot: JsValue, degrees: JsValue) -> JsResult<JsValue> {
    let snapshot: WorkspaceSnapshot = serde_wasm_bindgen::from_value(snapshot)?;
    let degrees: HashMap<String, u32> = serde_wasm_bindgen::from_value(degrees)?;
    serde_wasm_bindgen::to_value(&search_document::to_search_docs(&snapshot, &degrees))
}

/// [`search_revision`](search_document::search_revision).
///
/// # Errors
///
/// Fails if `docs` is not an array of search documents.
#[wasm_bindgen(js_name = searchRevision)]
pub fn search_revision_js(docs: JsValue) -> JsResult<String> {
    let docs: Vec<SearchDoc> = serde_wasm_bindgen::from_value(docs)?;
    Ok(search_document::search_revision(&docs))
}

/// [`extract_headings`](search_document::extract_headings).
#[wasm_bindgen(js_name = extractHeadings)]
pub fn extract_headings_js(body: Option<String>) -> Vec<String> {
    search_document::extract_headings(body.as_deref())
}

/// [`bounded_body`](search_document::bounded_body).
#[wasm_bindgen(js_name = boundedBody)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn bounded_body_js(body: String) -> String {
    search_document::bounded_body(&body)
}

/// [`to_pdf_search_docs`](search_document::to_pdf_search_docs).
///
/// # Errors
///
/// Fails if `sources` or `degrees` do not match the expected shape.
#[wasm_bindgen(js_name = toPdfSearchDocs)]
pub fn to_pdf_search_docs_js(sources: JsValue, degrees: JsValue) -> JsResult<JsValue> {
    let sources: Vec<PdfIndexSource> = serde_wasm_bindgen::from_value(sources)?;
    let degrees: HashMap<String, u32> = serde_wasm_bindgen::from_value(degrees)?;
    serde_wasm_bindgen::to_value(&search_document::to_pdf_search_docs(&sources, &degrees))
}

/// [`pdf_doc_id`](search_document::pdf_doc_id).
#[wasm_bindgen(js_name = pdfDocId)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn pdf_doc_id_js(paper_id: String, page_index: u32) -> String {
    search_document::pdf_doc_id(&paper_id, page_index)
}

/// [`pdf_page_href`](search_document::pdf_page_href).
#[wasm_bindgen(js_name = pdfPageHref)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn pdf_page_href_js(paper_id: String, page_index: u32) -> String {
    search_document::pdf_page_href(&paper_id, page_index)
}

/// [`pdf_doc_ids_for`](search_document::pdf_doc_ids_for).
#[wasm_bindgen(js_name = pdfDocIdsFor)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn pdf_doc_ids_for_js(paper_id: String, page_count: u32) -> Vec<String> {
    search_document::pdf_doc_ids_for(&paper_id, page_count)
}

/// [`annotation_doc_id`](search_document::annotation_doc_id).
#[wasm_bindgen(js_name = annotationDocId)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn annotation_doc_id_js(annotation_id: String) -> String {
    search_document::annotation_doc_id(&annotation_id)
}

/// [`to_annotation_search_docs`](search_document::to_annotation_search_docs).
/// `paper_titles` is a plain `{ paperId: title }` object.
///
/// # Errors
///
/// Fails if an argument does not match the expected shape.
#[wasm_bindgen(js_name = toAnnotationSearchDocs)]
pub fn to_annotation_search_docs_js(
    annotations: JsValue,
    paper_titles: JsValue,
    degrees: JsValue,
) -> JsResult<JsValue> {
    let annotations: Vec<AnnotationSource> = serde_wasm_bindgen::from_value(annotations)?;
    let titles: HashMap<String, String> = serde_wasm_bindgen::from_value(paper_titles)?;
    let degrees: HashMap<String, u32> = serde_wasm_bindgen::from_value(degrees)?;
    serde_wasm_bindgen::to_value(&search_document::to_annotation_search_docs(
        &annotations,
        &titles,
        &degrees,
    ))
}

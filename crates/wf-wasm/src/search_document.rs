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
use wf_core::search::excerpt::{ExcerptOptions, build_excerpt as core_build_excerpt};
use wf_core::search::projection;
use wf_core::search::search_document::{self, AnnotationSource, PdfIndexSource, SearchDoc};
use wf_core::search::tokenizer::{TokenizerOptions, index_terms as core_index_terms};
use wf_core::search::wiki_graph::WikiGraph;
use wf_core::sync::workspace_snapshot::WorkspaceSnapshot;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The longest prefix of `text` within `max` UTF-16 units, cut on a character boundary. The TS
/// slice it replaces could split a surrogate pair; this never does.
fn cap_utf16(text: &str, max: usize) -> &str {
    let mut units = 0;
    for (index, ch) in text.char_indices() {
        units += ch.len_utf16();
        if units > max {
            return &text[..index];
        }
    }
    text
}

/// The tokenizer defaults index and query share (TS `TOKENIZER_OPTIONS`).
fn index_tokenizer_options() -> TokenizerOptions {
    TokenizerOptions {
        fold_diacritics: true,
        fold_arabic_diacritics: false,
        split_camel_case: true,
        tokenize_urls: true,
    }
}

/// [`indexTermsOf`]: the index terms of `text`, cut to the longest text the index accepts rather
/// than throwing. Rust `index_terms` with the search tokenizer defaults.
#[wasm_bindgen(js_name = indexTermsOf)]
pub fn index_terms_of_js(text: &str) -> Vec<String> {
    core_index_terms(
        cap_utf16(text, crate::max_index_text_utf16()),
        &index_tokenizer_options(),
    )
}

/// [`excerptOf`]: a 200-character excerpt of `body` around `terms`, cut like [`index_terms_of_js`].
///
/// # Errors
///
/// Fails if `terms` is not an array of strings, or if the terms together need more than
/// `MAX_INDEX_TEXT_UTF16` units (each counts its length + 1), as the TS `buildExcerpt` does.
#[wasm_bindgen(js_name = excerptOf)]
pub fn excerpt_of_js(body: &str, terms: JsValue) -> Result<JsValue, JsValue> {
    let terms: Vec<String> = serde_wasm_bindgen::from_value(terms)?;
    let max = crate::max_index_text_utf16();
    let total: usize = terms
        .iter()
        .map(|term| term.encode_utf16().count() + 1)
        .sum();
    if total > max {
        return Err(JsValue::from_str(&format!(
            "terms need {total} UTF-16 units (length + 1 each); MAX_INDEX_TEXT_UTF16 is {max}"
        )));
    }
    let excerpt = core_build_excerpt(
        cap_utf16(body, max),
        &terms,
        ExcerptOptions {
            max_chars: Some(200),
            single_line: true,
        },
    );
    Ok(serde_wasm_bindgen::to_value(&excerpt)?)
}

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
pub fn search_revision_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { readonly id: string; readonly kind: B.SearchKind; readonly entityId: string; readonly title: string; readonly aliases: readonly string[]; readonly headings: readonly string[]; readonly tags: readonly string[]; readonly path: string; readonly body: string; readonly updatedAt: string; readonly href: string; readonly page?: number; readonly degree: number }[]"
    )]
    docs: JsValue,
) -> JsResult<String> {
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

/// [`project_search_documents`](projection::project_search_documents). `graph` is a wiki graph or
/// `null`; `pdfTexts` is the extracted PDF text array.
///
/// # Errors
///
/// Fails if an argument or a reader annotation does not match the expected shape.
#[wasm_bindgen(js_name = projectSearchDocuments)]
pub fn project_search_documents_js(
    snapshot: JsValue,
    graph: JsValue,
    pdf_texts: JsValue,
) -> Result<JsValue, JsValue> {
    let snapshot: WorkspaceSnapshot = serde_wasm_bindgen::from_value(snapshot)?;
    let graph: Option<WikiGraph> = serde_wasm_bindgen::from_value(graph)?;
    let pdf_texts: Vec<PdfIndexSource> = serde_wasm_bindgen::from_value(pdf_texts)?;
    let docs = projection::project_search_documents(&snapshot, graph.as_ref(), &pdf_texts)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(serde_wasm_bindgen::to_value(&docs)?)
}

/// [`project_stored_pdf_texts`](projection::project_stored_pdf_texts): the worker's build.
///
/// # Errors
///
/// Fails if an argument or a reader annotation does not match the expected shape.
#[wasm_bindgen(js_name = projectStoredPdfTexts, unchecked_return_type = "B.StoredPdfProjection")]
pub fn project_stored_pdf_texts_js(
    #[wasm_bindgen(unchecked_param_type = "object")] snapshot: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "readonly (Omit<B.PdfIndexSource, \"pages\"> & { pages?: readonly B.PdfPageText[] })[]"
    )]
    stored: JsValue,
) -> Result<JsValue, JsValue> {
    let snapshot: WorkspaceSnapshot = serde_wasm_bindgen::from_value(snapshot)?;
    let stored: Vec<PdfIndexSource> = serde_wasm_bindgen::from_value(stored)?;
    let projection = projection::project_stored_pdf_texts(&snapshot, &stored)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(serde_wasm_bindgen::to_value(&projection)?)
}

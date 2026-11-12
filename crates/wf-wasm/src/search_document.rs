//! Search-document projections for JavaScript (wf-core `search::search_document`).
//! The JS names match `packages/core/src/search/search-document.ts`,
//! `pdf-search-document.ts` and `annotation-search-document.ts`.

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned values"
)]
use std::collections::HashMap;

use js_sys::{Array, JsString, Object, Reflect};
use serde::de::DeserializeOwned;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::excerpt::{ExcerptOptions, build_excerpt as core_build_excerpt};
use wf_core::search::projection;
use wf_core::search::search_document::{self, AnnotationSource, PdfIndexSource, SearchDoc};
use wf_core::search::tokenizer::{TokenizerOptions, index_terms as core_index_terms};
use wf_core::search::wiki_graph::WikiGraph;
use wf_core::sync::workspace_snapshot::WorkspaceSnapshot;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// A `ReadonlyMap<string, V>` (or any entries iterable) read as `Object.fromEntries` reads it.
///
/// # Errors
///
/// Fails if `map` is not an entries iterable or a value does not deserialize to `T`.
pub(crate) fn map_arg<T: DeserializeOwned>(map: &JsValue) -> Result<HashMap<String, T>, JsValue> {
    Ok(serde_wasm_bindgen::from_value(
        Object::from_entries(map)?.into(),
    )?)
}

/// [`map_arg`], with a missing map read as empty (the TS default `new Map()`).
fn optional_map_arg<T: DeserializeOwned>(
    map: Option<JsValue>,
) -> Result<HashMap<String, T>, JsValue> {
    map.map_or_else(|| Ok(HashMap::new()), |map| map_arg(&map))
}

/// The TS wiki graph (`{ nodes, edges: Map<node, neighbours> }`, or a falsy value for none) as
/// the wire rows Rust reads, in the map's insertion order.
fn wire_graph(graph: &JsValue) -> Result<Option<WikiGraph>, JsValue> {
    if graph.is_falsy() {
        return Ok(None);
    }
    let nodes = Array::from(&Reflect::get(graph, &JsValue::from_str("nodes"))?);
    let edges = Array::from(&Reflect::get(graph, &JsValue::from_str("edges"))?);
    let rows = Array::new();
    for entry in edges.iter() {
        let row = Object::new();
        let _ = Reflect::set(
            &row,
            &JsValue::from_str("node"),
            &Reflect::get_u32(&entry, 0)?,
        )?;
        let neighbours = Array::from(&Reflect::get_u32(&entry, 1)?);
        let _ = Reflect::set(&row, &JsValue::from_str("neighbours"), &neighbours)?;
        let _ = rows.push(&row);
    }
    let wire = Object::new();
    let _ = Reflect::set(&wire, &JsValue::from_str("nodes"), &nodes)?;
    let _ = Reflect::set(&wire, &JsValue::from_str("edges"), &rows)?;
    Ok(Some(serde_wasm_bindgen::from_value(wire.into())?))
}

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
#[wasm_bindgen(
    js_name = excerptOf,
    unchecked_return_type = "{ text: string; highlights: { start: number; end: number }[] }"
)]
pub fn excerpt_of_js(
    body: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] terms: JsValue,
) -> Result<JsValue, JsValue> {
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
    // The text comes back as UTF-16 units (a lone surrogate survives); chunks keep each
    // `String.fromCharCode` call under the argument limit.
    let mut text = JsString::from("");
    for chunk in excerpt.text.chunks(8192) {
        text = text.concat(&JsString::from_char_code(chunk));
    }
    let out = Object::new();
    let _ = Reflect::set(&out, &JsValue::from_str("text"), &text)?;
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("highlights"),
        &serde_wasm_bindgen::to_value(&excerpt.highlights)?,
    )?;
    Ok(out.into())
}

/// [`to_search_docs`](search_document::to_search_docs). `degrees` maps `kind:id` to a link
/// count and defaults to empty.
///
/// # Errors
///
/// Fails if `snapshot` or `degrees` do not match the expected shape.
#[wasm_bindgen(js_name = toSearchDocs, unchecked_return_type = "B.SearchDoc[]")]
pub fn to_search_docs_js(
    #[wasm_bindgen(unchecked_param_type = "object")] snapshot: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "ReadonlyMap<string, number>")] degrees: Option<
        JsValue,
    >,
) -> Result<JsValue, JsValue> {
    let snapshot: WorkspaceSnapshot = serde_wasm_bindgen::from_value(snapshot)?;
    let degrees: HashMap<String, u32> = optional_map_arg(degrees)?;
    Ok(serde_wasm_bindgen::to_value(
        &search_document::to_search_docs(&snapshot, &degrees),
    )?)
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

/// [`bounded_body`](search_document::bounded_body); a missing body reads as empty.
#[wasm_bindgen(js_name = boundedBody)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn bounded_body_js(body: Option<String>) -> String {
    search_document::bounded_body(body.as_deref().unwrap_or_default())
}

/// [`to_pdf_search_docs`](search_document::to_pdf_search_docs). `degrees` defaults to empty.
///
/// # Errors
///
/// Fails if `sources` or `degrees` do not match the expected shape.
#[wasm_bindgen(js_name = toPdfSearchDocs, unchecked_return_type = "B.SearchDoc[]")]
pub fn to_pdf_search_docs_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly (Required<Omit<B.PdfIndexSource, \"pages\">> & { pages: readonly Required<B.PdfPageText>[] })[]"
    )]
    sources: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "ReadonlyMap<string, number>")] degrees: Option<
        JsValue,
    >,
) -> Result<JsValue, JsValue> {
    let sources: Vec<PdfIndexSource> = serde_wasm_bindgen::from_value(sources)?;
    let degrees: HashMap<String, u32> = optional_map_arg(degrees)?;
    Ok(serde_wasm_bindgen::to_value(
        &search_document::to_pdf_search_docs(&sources, &degrees),
    )?)
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

/// [`pdf_id_prefix`](search_document::pdf_id_prefix).
#[wasm_bindgen(js_name = pdfIdPrefix)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn pdf_id_prefix_js(paper_id: String) -> String {
    search_document::pdf_id_prefix(&paper_id)
}

/// [`kind_of_id`](search_document::kind_of_id). `undefined` when there is no `:`.
#[wasm_bindgen(js_name = kindOfId)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn kind_of_id_js(id: String) -> Option<String> {
    search_document::kind_of_id(&id).map(str::to_owned)
}

/// [`is_large_corpus`](search_document::is_large_corpus).
#[wasm_bindgen(js_name = isLargeCorpus)]
pub fn is_large_corpus_js(documents: u32) -> bool {
    search_document::is_large_corpus(documents)
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
/// `paper_titles` maps a paper id to its title; `degrees` defaults to empty.
///
/// # Errors
///
/// Fails if an argument does not match the expected shape.
#[wasm_bindgen(js_name = toAnnotationSearchDocs, unchecked_return_type = "B.SearchDoc[]")]
pub fn to_annotation_search_docs_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnnotationSource[]")] annotations: JsValue,
    #[wasm_bindgen(unchecked_param_type = "ReadonlyMap<string, string>")] paper_titles: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "ReadonlyMap<string, number>")] degrees: Option<
        JsValue,
    >,
) -> Result<JsValue, JsValue> {
    let annotations: Vec<AnnotationSource> = serde_wasm_bindgen::from_value(annotations)?;
    let titles: HashMap<String, String> = map_arg(&paper_titles)?;
    let degrees: HashMap<String, u32> = optional_map_arg(degrees)?;
    Ok(serde_wasm_bindgen::to_value(
        &search_document::to_annotation_search_docs(&annotations, &titles, &degrees),
    )?)
}

/// [`project_search_documents`](projection::project_search_documents). `graph` is the TS wiki
/// graph (edges as a `Map`), or `null` when degrees are not wanted; `pdfTexts` is the extracted
/// PDF text array.
///
/// # Errors
///
/// Fails if an argument or a reader annotation does not match the expected shape.
#[wasm_bindgen(js_name = projectSearchDocuments, unchecked_return_type = "B.SearchDoc[]")]
pub fn project_search_documents_js(
    #[wasm_bindgen(unchecked_param_type = "object")] snapshot: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ nodes: string[]; edges: Map<string, string[]> } | null"
    )]
    graph: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "readonly (Required<Omit<B.PdfIndexSource, \"pages\">> & { pages: readonly Required<B.PdfPageText>[] })[]"
    )]
    pdf_texts: JsValue,
) -> Result<JsValue, JsValue> {
    let snapshot: WorkspaceSnapshot = serde_wasm_bindgen::from_value(snapshot)?;
    let graph = wire_graph(&graph)?;
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

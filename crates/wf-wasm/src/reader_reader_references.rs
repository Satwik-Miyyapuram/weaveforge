//! Reference index for JavaScript (`apps/web/src/features/reader/application/reader-references.ts`).
//! Wraps `wf_core::reader::reader_references`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::reader_references::{
    build_reference_index, index_from_analysis, outline_items_for,
};
use wf_core::reader_analysis::document_analysis::DocumentAnalysis;
use wf_core::reader_analysis::outline::OutlineReaderItem;
use wf_core::reader_analysis::types::AnalysisPdfPage;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`build_reference_index`]: analyzes the pages and shapes the overlay's index.
///
/// # Errors
///
/// Fails if `pages` or `outline` do not have the expected shape.
#[wasm_bindgen(js_name = buildReferenceIndex)]
pub fn build_reference_index_js(pages: JsValue, outline: JsValue) -> JsResult<JsValue> {
    let pages: Vec<AnalysisPdfPage> = serde_wasm_bindgen::from_value(pages)?;
    let outline: Vec<OutlineReaderItem> = serde_wasm_bindgen::from_value(outline)?;
    to_js(&build_reference_index(&pages, &outline))
}

/// [`index_from_analysis`]: shapes an analysis the worker already ran into the overlay's index.
///
/// # Errors
///
/// Fails if `analysis` or `pages` do not have the expected shape.
#[wasm_bindgen(js_name = indexFromAnalysis)]
pub fn index_from_analysis_js(analysis: JsValue, pages: JsValue) -> JsResult<JsValue> {
    let analysis: DocumentAnalysis = serde_wasm_bindgen::from_value(analysis)?;
    let pages: Vec<AnalysisPdfPage> = serde_wasm_bindgen::from_value(pages)?;
    to_js(&index_from_analysis(&analysis, &pages))
}

/// [`outline_items_for`]: each page's runs as outline items.
///
/// # Errors
///
/// Fails if `pages` does not have the expected shape.
#[wasm_bindgen(js_name = outlineItemsFor)]
pub fn outline_items_for_js(pages: JsValue) -> JsResult<JsValue> {
    let pages: Vec<AnalysisPdfPage> = serde_wasm_bindgen::from_value(pages)?;
    to_js(&outline_items_for(&pages))
}

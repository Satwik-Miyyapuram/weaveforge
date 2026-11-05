//! The full PDF analysis pass for JavaScript (wf-core `reader_analysis::document_analysis`).
//! The JS name and shapes match `packages/core/src/features/reader/analysis/document-analysis.ts`.
//!
//! Pages and the outline cross as plain JS objects through serde. The TS wrapper in
//! `packages/wf-wasm/src/reader-analysis-document.ts` applies the `outline = []` default.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::document_analysis;
use wf_core::reader_analysis::outline::OutlineReaderItem;
use wf_core::reader_analysis::types::AnalysisPdfPage;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`analyze_pdf_document`](document_analysis::analyze_pdf_document) (TS `analyzePdfDocument`).
///
/// # Errors
///
/// Fails if `pages` is not an array of analysis pages or `outline` not an array of outline items.
#[wasm_bindgen(js_name = analyzePdfDocument)]
pub fn analyze_pdf_document_js(pages: JsValue, outline: JsValue) -> JsResult<JsValue> {
    let pages: Vec<AnalysisPdfPage> = serde_wasm_bindgen::from_value(pages)?;
    let outline: Vec<OutlineReaderItem> = serde_wasm_bindgen::from_value(outline)?;
    to_js(&document_analysis::analyze_pdf_document(&pages, &outline))
}

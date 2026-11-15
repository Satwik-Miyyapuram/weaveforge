//! The full PDF analysis pass for JavaScript (wf-core `reader_analysis::document_analysis`).
//! The JS name and shapes match `packages/core/src/features/reader/analysis/document-analysis.ts`.
//!
//! Pages and the outline cross as plain JS objects through serde; `outline` defaults to `[]`.

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
#[wasm_bindgen(js_name = analyzePdfDocument, unchecked_return_type = "B.DocumentAnalysis")]
pub fn analyze_pdf_document_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisPdfPage[]")] pages: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "readonly B.OutlineReaderItem[]")]
    outline: Option<JsValue>,
) -> JsResult<JsValue> {
    let pages: Vec<AnalysisPdfPage> = serde_wasm_bindgen::from_value(pages)?;
    let outline: Vec<OutlineReaderItem> = match outline {
        Some(outline) => serde_wasm_bindgen::from_value(outline)?,
        None => Vec::new(),
    };
    to_js(&document_analysis::analyze_pdf_document(&pages, &outline))
}

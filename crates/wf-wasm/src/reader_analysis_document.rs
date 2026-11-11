//! The full PDF analysis pass for JavaScript (wf-core `reader_analysis::document_analysis`).
//! The JS name and shapes match `packages/core/src/features/reader/analysis/document-analysis.ts`.
//!
//! Pages and the outline cross as plain JS objects through serde. The TS wrapper in
//! `packages/wf-wasm/src/wrappers-6.ts` applies the `outline = []` default.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::document_analysis;
use wf_core::reader_analysis::outline::OutlineReaderItem;
use wf_core::reader_analysis::text::AnalysisPdfItem;
use wf_core::reader_analysis::types::AnalysisPdfPage;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`outline_item_of`](document_analysis::outline_item_of) (TS `outlineItemOf`).
///
/// # Errors
///
/// Fails if `item` is not a pdf.js text item with a `transform` array.
#[wasm_bindgen(js_name = outlineItemOf, unchecked_return_type = "B.OutlineTextItem")]
pub fn outline_item_of_js(
    #[wasm_bindgen(unchecked_param_type = "B.AnalysisPdfItem")] item: JsValue,
    page: f64,
) -> JsResult<JsValue> {
    let item: AnalysisPdfItem = serde_wasm_bindgen::from_value(item)?;
    to_js(&document_analysis::outline_item_of(&item, page))
}

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

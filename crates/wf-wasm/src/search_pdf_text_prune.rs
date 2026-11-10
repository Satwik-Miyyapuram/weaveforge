//! PDF text orphan partition for JavaScript (wf-core `search::pdf_text_prune`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::pdf_text_prune;
use wf_core::search::search_document::PdfIndexSource;

use super::to_js;

/// [`partition_pdf_texts`](pdf_text_prune::partition_pdf_texts): which stored PDF texts survive and which to delete.
///
/// # Errors
///
/// Fails if `stored` is not an array of PDF sources or `paper_ids` is not an array of strings.
#[wasm_bindgen(js_name = partitionPdfTexts)]
pub fn partition_pdf_texts_js(
    stored: JsValue,
    paper_ids: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let stored: Vec<PdfIndexSource> = serde_wasm_bindgen::from_value(stored)?;
    let paper_ids: Vec<String> = serde_wasm_bindgen::from_value(paper_ids)?;
    to_js(&pdf_text_prune::partition_pdf_texts(&stored, &paper_ids))
}

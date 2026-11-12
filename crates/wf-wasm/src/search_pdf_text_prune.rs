//! PDF text orphan partition for JavaScript (wf-core `search::pdf_text_prune`).

use js_sys::{Array, Map, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::search::pdf_text_prune;
use wf_core::search::search_document::PdfIndexSource;

use super::to_js;

/// [`partition_pdf_texts`](pdf_text_prune::partition_pdf_texts): which stored PDF texts survive and which to delete.
///
/// Returns `{ kept, pageCounts, orphanPaperIds }`; `pageCounts` is a JS `Map` from paper id to
/// page count, in `Object.entries` order of the counts.
///
/// # Errors
///
/// Fails if `stored` is not an array of PDF sources or `paper_ids` is not an array of strings.
#[wasm_bindgen(
    js_name = partitionPdfTexts,
    unchecked_return_type = "{ readonly kept: readonly number[]; readonly pageCounts: Map<string, number>; readonly orphanPaperIds: readonly string[] }"
)]
pub fn partition_pdf_texts_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly (Omit<B.PdfIndexSource, \"pages\"> & { pages?: readonly B.PdfPageText[] })[]"
    )]
    stored: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] paper_ids: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let stored: Vec<PdfIndexSource> = serde_wasm_bindgen::from_value(stored)?;
    let paper_ids: Vec<String> = serde_wasm_bindgen::from_value(paper_ids)?;
    let partition = pdf_text_prune::partition_pdf_texts(&stored, &paper_ids);
    let counts = to_js(&partition.page_counts)?;
    let page_counts = Map::new();
    for entry in Object::entries(counts.unchecked_ref()).iter() {
        let pair: Array = entry.unchecked_into();
        let _ = page_counts.set(&pair.get(0), &pair.get(1));
    }
    let out = Object::new();
    let _ = Reflect::set(&out, &"kept".into(), &to_js(&partition.kept)?)?;
    let _ = Reflect::set(&out, &"pageCounts".into(), &page_counts)?;
    let _ = Reflect::set(
        &out,
        &"orphanPaperIds".into(),
        &to_js(&partition.orphan_paper_ids)?,
    )?;
    Ok(out.into())
}

//! PDF text orphan partition for JavaScript (wf-core `search::pdf_text_prune`).

use js_sys::{Array, Map, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::search::pdf_text_prune::{self, PdfTextPartition};
use wf_core::search::search_document::PdfIndexSource;

use super::to_js;

/// The `pageCounts` `Map` of a partition: paper id to page count, in `Object.entries` order of
/// the counts.
fn page_counts_map(partition: &PdfTextPartition) -> Result<Map, serde_wasm_bindgen::Error> {
    let counts = to_js(&partition.page_counts)?;
    let page_counts = Map::new();
    for entry in Object::entries(counts.unchecked_ref()).iter() {
        let pair: Array = entry.unchecked_into();
        let _ = page_counts.set(&pair.get(0), &pair.get(1));
    }
    Ok(page_counts)
}

/// Parses the stored sources and the live paper ids, and partitions them.
fn partition_from_js(
    stored: JsValue,
    paper_ids: JsValue,
) -> Result<PdfTextPartition, serde_wasm_bindgen::Error> {
    let stored: Vec<PdfIndexSource> = serde_wasm_bindgen::from_value(stored)?;
    let paper_ids: Vec<String> = serde_wasm_bindgen::from_value(paper_ids)?;
    Ok(pdf_text_prune::partition_pdf_texts(&stored, &paper_ids))
}

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
) -> Result<JsValue, JsValue> {
    let partition = partition_from_js(stored, paper_ids)?;
    let out = Object::new();
    let _ = Reflect::set(&out, &"kept".into(), &to_js(&partition.kept)?)?;
    let _ = Reflect::set(
        &out,
        &"pageCounts".into(),
        &JsValue::from(page_counts_map(&partition)?),
    )?;
    let _ = Reflect::set(
        &out,
        &"orphanPaperIds".into(),
        &to_js(&partition.orphan_paper_ids)?,
    )?;
    Ok(out.into())
}

/// The stored PDF texts whose paper still exists, as the caller's own objects, with the page
/// counts and the orphan paper ids (the ones to delete from storage).
///
/// Returns `{ texts, pageCounts, orphanPaperIds }`; `texts` holds the elements of `stored` that
/// survive, in their stored order.
///
/// # Errors
///
/// Fails if `stored` is not an array of PDF sources or `paper_ids` is not an array of strings.
#[wasm_bindgen(
    js_name = livePdfTexts,
    unchecked_return_type = "{ readonly texts: readonly T.PdfIndexSource[]; readonly pageCounts: Map<string, number>; readonly orphanPaperIds: readonly string[] }"
)]
pub fn live_pdf_texts_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly (Omit<B.PdfIndexSource, \"pages\"> & { pages?: readonly B.PdfPageText[] })[]"
    )]
    stored: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] paper_ids: JsValue,
) -> Result<JsValue, JsValue> {
    let source: Array = stored.clone().unchecked_into();
    let partition = partition_from_js(stored, paper_ids)?;
    let texts = Array::new();
    for index in &partition.kept {
        let index = *index;
        let _ = texts.push(&source.get(index));
    }
    let out = Object::new();
    let _ = Reflect::set(&out, &"texts".into(), &texts)?;
    let _ = Reflect::set(
        &out,
        &"pageCounts".into(),
        &JsValue::from(page_counts_map(&partition)?),
    )?;
    let _ = Reflect::set(
        &out,
        &"orphanPaperIds".into(),
        &to_js(&partition.orphan_paper_ids)?,
    )?;
    Ok(out.into())
}

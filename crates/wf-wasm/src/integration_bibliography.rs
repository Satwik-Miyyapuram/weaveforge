//! wasm export for `integrations::bibliography_annotations` (TS: `integration-bibliography.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::integrations::bibliography_annotations::{
    BibliographyPull, PaperForPull, plan_bibliography_annotations,
};

use super::to_js;

/// [`plan_bibliography_annotations`]. `papers` is an array of paper snapshots,
/// `pull` the pulled annotations keyed by Zotero item key.
///
/// # Errors
///
/// Fails if an argument has the wrong shape, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = planBibliographyAnnotations)]
pub fn plan_bibliography_annotations_js(
    papers: JsValue,
    pull: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let papers: Vec<PaperForPull> = serde_wasm_bindgen::from_value(papers)?;
    let pull: BibliographyPull = serde_wasm_bindgen::from_value(pull)?;
    to_js(&plan_bibliography_annotations(&papers, &pull))
}

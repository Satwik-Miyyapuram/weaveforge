//! PDF add decisions for JavaScript (wf-core `papers::pdf_add_plan`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::pdf_add_plan::{self, PdfAddFacts, PdfLookupFacts};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`plan_pdf_add`](pdf_add_plan::plan_pdf_add) (TS `addPaperFromPdf`): the match, title source
/// and kept-PDF decisions for one dropped PDF, from the results of its I/O.
///
/// # Errors
///
/// Fails if `facts` cannot be read as the add facts, or the plan cannot be converted to a JS value.
#[wasm_bindgen(js_name = planPdfAdd, unchecked_return_type = "B.PdfAddPlan")]
pub fn plan_pdf_add_js(
    #[wasm_bindgen(unchecked_param_type = "B.PdfAddFacts")] facts: JsValue,
) -> JsResult<JsValue> {
    let facts: PdfAddFacts = serde_wasm_bindgen::from_value(facts)?;
    to_js(&pdf_add_plan::plan_pdf_add(facts))
}

/// [`pdf_lookup_steps`](pdf_add_plan::pdf_lookup_steps) (TS `addPaperFromPdf`): the lookups to
/// try for one dropped PDF, in order, stopping at the first hit.
///
/// # Errors
///
/// Fails if `facts` cannot be read as the lookup facts, or the steps cannot be converted to a JS value.
#[wasm_bindgen(js_name = planPdfLookups, unchecked_return_type = "B.PdfLookupStep[]")]
pub fn plan_pdf_lookups_js(
    #[wasm_bindgen(unchecked_param_type = "B.PdfLookupFacts")] facts: JsValue,
) -> JsResult<JsValue> {
    let facts: PdfLookupFacts = serde_wasm_bindgen::from_value(facts)?;
    to_js(&pdf_add_plan::pdf_lookup_steps(facts))
}

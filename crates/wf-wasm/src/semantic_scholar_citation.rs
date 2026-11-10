//! Semantic Scholar citation field rules for JavaScript (wf-core `relations::semantic_scholar_citation`).
//! The JS names match `packages/wf-wasm/src/semantic-scholar-citation.ts`.

use serde::Deserialize;
use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::paper_ref::PaperRefKind;
use wf_core::relations::semantic_scholar_citation::{self, S2ExternalIds};

use super::to_js;

/// A paper reference from JS: its kind (`arxiv`, `doi`, ...) and value.
#[derive(Deserialize)]
struct RefArg {
    kind: PaperRefKind,
    value: String,
}

/// [`citation_contexts`](semantic_scholar_citation::citation_contexts): trimmed snippets, or
/// nothing when none remain.
///
/// # Errors
///
/// Fails if the value cannot be read as JSON.
#[wasm_bindgen(js_name = citationContexts)]
pub fn citation_contexts_js(raw: JsValue) -> Result<JsValue, JsValue> {
    let raw: Value = serde_wasm_bindgen::from_value(raw)?;
    Ok(to_js(&semantic_scholar_citation::citation_contexts(&raw))?)
}

/// [`citation_intents`](semantic_scholar_citation::citation_intents): the known intents, or
/// nothing when none remain.
///
/// # Errors
///
/// Fails if the value cannot be read as JSON.
#[wasm_bindgen(js_name = citationIntents)]
pub fn citation_intents_js(raw: JsValue) -> Result<JsValue, JsValue> {
    let raw: Value = serde_wasm_bindgen::from_value(raw)?;
    Ok(to_js(&semantic_scholar_citation::citation_intents(&raw))?)
}

/// [`external_id_ref`](semantic_scholar_citation::external_id_ref): the lookup reference for
/// a paper's external ids, or nothing.
///
/// # Errors
///
/// Fails if `ids` has the wrong shape.
#[wasm_bindgen(js_name = citationExternalIdRef)]
pub fn citation_external_id_ref_js(ids: JsValue) -> Result<JsValue, JsValue> {
    let ids: Option<S2ExternalIds> = serde_wasm_bindgen::from_value(ids)?;
    Ok(to_js(&semantic_scholar_citation::external_id_ref(
        ids.as_ref(),
    ))?)
}

/// [`s2_paper_id`](semantic_scholar_citation::s2_paper_id): the Semantic Scholar id for a reference.
///
/// # Errors
///
/// Fails if `reference` has the wrong shape.
#[wasm_bindgen(js_name = s2PaperId)]
pub fn s2_paper_id_js(reference: JsValue) -> Result<String, JsValue> {
    let reference: RefArg = serde_wasm_bindgen::from_value(reference)?;
    Ok(semantic_scholar_citation::s2_paper_id(
        reference.kind,
        &reference.value,
    ))
}

/// [`next_page_offset`](semantic_scholar_citation::next_page_offset): the next offset, or `-1`
/// to stop. A non-number `next` is read as missing, as the TS did.
///
/// # Errors
///
/// Fails if `next` cannot be read as JSON.
#[wasm_bindgen(js_name = nextCitationPageOffset)]
pub fn next_citation_page_offset_js(
    current_offset: f64,
    next: JsValue,
    pages_fetched: f64,
) -> Result<f64, JsValue> {
    let next: Value = serde_wasm_bindgen::from_value(next)?;
    Ok(semantic_scholar_citation::next_page_offset(
        current_offset,
        next.as_f64(),
        pages_fetched,
    ))
}

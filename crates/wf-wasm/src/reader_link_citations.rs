//! Internal `/Link` citation mentions for JavaScript (wf-core `reader::link_citations`). The JS
//! names and shapes match `packages/core/src/features/reader/link-citations.ts`.
//!
//! Objects cross as plain JS objects through serde. The TS wrapper in
//! `packages/wf-wasm/src/reader-link-citations.ts` keeps the TS signatures.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::link_citations::{self, LinkCitationPage};
use wf_core::reader_analysis::types::{AnalysisLinkDest, AnalysisParsedReference, AnalysisPdfLink};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`reference_for_destination`](link_citations::reference_for_destination) (TS
/// `referenceForDestination`); `null` when no entry is found.
///
/// # Errors
///
/// Fails if `dest` or `refs` do not have the expected shape.
#[wasm_bindgen(js_name = referenceForDestination)]
pub fn reference_for_destination_js(dest: JsValue, refs: JsValue) -> JsResult<JsValue> {
    let dest: AnalysisLinkDest = serde_wasm_bindgen::from_value(dest)?;
    let refs: Vec<AnalysisParsedReference> = serde_wasm_bindgen::from_value(refs)?;
    to_js(&link_citations::reference_for_destination(&dest, &refs).cloned())
}

/// [`covered_text_spans`](link_citations::covered_text_spans) (TS `coveredTextSpans`).
///
/// # Errors
///
/// Fails if `page` or `links` do not have the expected shape.
#[wasm_bindgen(js_name = coveredTextSpans)]
pub fn covered_text_spans_js(page: JsValue, links: JsValue) -> JsResult<JsValue> {
    let page: LinkCitationPage = serde_wasm_bindgen::from_value(page)?;
    let links: Vec<AnalysisPdfLink> = serde_wasm_bindgen::from_value(links)?;
    to_js(&link_citations::covered_text_spans(&page, &links))
}

/// [`link_citation_mentions`](link_citations::link_citation_mentions) (TS
/// `linkCitationMentions`).
///
/// # Errors
///
/// Fails if `page`, `links` or `refs` do not have the expected shape.
#[wasm_bindgen(js_name = linkCitationMentions)]
pub fn link_citation_mentions_js(
    page: JsValue,
    links: JsValue,
    refs: JsValue,
) -> JsResult<JsValue> {
    let page: LinkCitationPage = serde_wasm_bindgen::from_value(page)?;
    let links: Vec<AnalysisPdfLink> = serde_wasm_bindgen::from_value(links)?;
    let refs: Vec<AnalysisParsedReference> = serde_wasm_bindgen::from_value(refs)?;
    to_js(&link_citations::link_citation_mentions(
        &page, &links, &refs,
    ))
}

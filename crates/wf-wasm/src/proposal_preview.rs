//! The AI proposal card's preview split (wf-core `ai::proposal_preview`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::proposal_preview as preview;

use super::to_js;

/// [`split_proposal_content`](preview::split_proposal_content).
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = splitProposalContent, unchecked_return_type = "B.ProposalPreview")]
pub fn split_proposal_content_js(content: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&preview::split_proposal_content(content))
}

//! AI proposal shaping for JavaScript (wf-core `ai::proposal_draft`). The JS name matches
//! `packages/core/src/features/ai-assistant/application/create-ai-proposal-draft.use-case.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::ai::proposal_draft::{self, ProposalDraftInput};

use super::to_js;

/// [`shape_proposal_draft`](proposal_draft::shape_proposal_draft): the pending proposal to save.
///
/// # Errors
///
/// Fails with `AI proposal preview is required.` for blank content, or when the input is malformed.
#[wasm_bindgen(js_name = shapeAiProposalDraft)]
pub fn shape_ai_proposal_draft_js(input: JsValue) -> Result<JsValue, JsError> {
    let input: ProposalDraftInput = serde_wasm_bindgen::from_value(input).map_err(js_error)?;
    let draft =
        proposal_draft::shape_proposal_draft(input).map_err(|message| JsError::new(&message))?;
    to_js(&draft).map_err(js_error)
}

fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

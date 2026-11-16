//! Proposal-apply check for JavaScript (wf-core `ai::proposal_apply`). The JS name matches
//! `proposalApplies` in `packages/core/src/features/ai-assistant/application/parts.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::proposal_apply;

/// [`proposal_applies`](proposal_apply::proposal_applies). `null` or `undefined` for the stored
/// revision means the row is missing.
#[must_use]
#[wasm_bindgen(js_name = proposalApplies)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn proposal_applies_js(
    stored_updated_at: Option<String>,
    expected_revision: Option<String>,
) -> bool {
    proposal_apply::proposal_applies(stored_updated_at.as_deref(), expected_revision.as_deref())
}

//! AI review queue grouping for JavaScript (wf-core `proposal_groups`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::proposal_groups::{self, ProposalGrouping, ProposalRef};

use super::to_js;

/// [`group_proposals`](proposal_groups::group_proposals). `items` is a list of objects with
/// `kind` and `resourceId`; `by` is `"document"` or `"kind"`; `knownIds` is an optional string
/// array. Returns `{ key, indices }[]`, with indices into `items`.
///
/// # Errors
///
/// Fails if an input cannot be read as the expected shape.
#[wasm_bindgen(js_name = groupProposals)]
pub fn group_proposals_js(
    items: JsValue,
    by: JsValue,
    known_ids: JsValue,
) -> Result<JsValue, JsError> {
    let items: Vec<ProposalRef> =
        serde_wasm_bindgen::from_value(items).map_err(|e| JsError::new(&e.to_string()))?;
    let by: ProposalGrouping =
        serde_wasm_bindgen::from_value(by).map_err(|e| JsError::new(&e.to_string()))?;
    let known: Option<Vec<String>> =
        serde_wasm_bindgen::from_value(known_ids).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&proposal_groups::group_proposals(
        &items,
        by,
        known.as_deref(),
    ))
    .map_err(|e| JsError::new(&e.to_string()))
}

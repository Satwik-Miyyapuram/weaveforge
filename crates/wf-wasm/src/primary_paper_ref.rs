//! Primary external id of a stored paper for JavaScript (wf-core `papers::paper_ref`). JS name
//! matches `packages/core/src/features/relations/application/paper-ref.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::paper_ref::primary_paper_ref;

use super::to_js;

/// [`primary_paper_ref`]: the arXiv id, else the DOI, else `null`. Blank strings count as unset.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
#[wasm_bindgen(js_name = primaryPaperRef, unchecked_return_type = "B.PaperRef | null")]
pub fn primary_paper_ref_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] arxiv_id: Option<
        String,
    >,
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] doi: Option<
        String,
    >,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&primary_paper_ref(arxiv_id.as_deref(), doi.as_deref()))
}

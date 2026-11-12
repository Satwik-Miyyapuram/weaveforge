//! Blank-document check for model concept extraction (wf-core `ai::document_text`).
//! The JS name matches `ModelConceptExtractor.extract` in `packages/core/src/features/ai-assistant/domain/`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::document_text::has_text;

/// [`has_text`] (TS `ModelConceptExtractor.extract` document filter).
#[wasm_bindgen(js_name = hasText)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn has_text_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] text: Option<
        String,
    >,
) -> bool {
    has_text(text.as_deref())
}

//! Paper note appending for JavaScript (wf-core `paper_note`). JS name matches
//! `packages/core/src/features/ai-assistant/domain/ai-write-proposal.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::paper_note::append_paper_note;

/// [`append_paper_note`]: the note with `addition` appended, or `undefined` when the addition is
/// blank.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
#[must_use]
#[wasm_bindgen(js_name = appendPaperNote)]
pub fn append_paper_note_js(existing: Option<String>, addition: String) -> Option<String> {
    append_paper_note(existing.as_deref(), &addition)
}

//! The Overleaf card picture's storage key and size gate (wf-core `overleaf::thumb`). The TS
//! wrapper `packages/wf-wasm/src/overleaf-thumb.ts` gives them their types.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::overleaf::thumb;

/// [`thumb_key`](thumb::thumb_key): the local storage key for a project's picture.
#[wasm_bindgen(js_name = thumbKey)]
pub fn thumb_key(project_id: &str) -> String {
    thumb::thumb_key(project_id)
}

/// [`fits_budget`](thumb::fits_budget): whether a data URL of `len` characters is kept. A length
/// that does not fit in `usize` is never kept.
#[wasm_bindgen(js_name = thumbFits)]
pub fn thumb_fits(len: u32) -> bool {
    usize::try_from(len).is_ok_and(thumb::fits_budget)
}

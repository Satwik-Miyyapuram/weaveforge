//! Plain-text helpers for JavaScript (wf-core `text`). The JS name matches
//! `packages/core/src/shared/text.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::text;

/// [`count_words`](text::count_words): runs of non-whitespace in `text`.
#[wasm_bindgen(js_name = countWords)]
#[must_use]
pub fn count_words_js(text: &str) -> usize {
    text::count_words(text)
}

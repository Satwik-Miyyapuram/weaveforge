//! Hashtag edits on a note body (wf-core `papers::note_tags`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::note_tags;

/// [`remove_hashtag_from_body`](note_tags::remove_hashtag_from_body).
#[wasm_bindgen(js_name = removeHashtagFromBody)]
#[must_use]
pub fn remove_hashtag_from_body_js(body: &str, tag: &str) -> String {
    note_tags::remove_hashtag_from_body(body, tag)
}

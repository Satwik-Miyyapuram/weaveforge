//! Hashtag edits on a note body (wf-core `papers::note_tags`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::note_tags;

/// [`tag_to_hashtag`](note_tags::tag_to_hashtag). Empty when the name has no usable characters.
#[wasm_bindgen(js_name = tagToHashtag)]
#[must_use]
pub fn tag_to_hashtag_js(name: &str) -> String {
    note_tags::tag_to_hashtag(name)
}

/// [`append_tag_hashtags`](note_tags::append_tag_hashtags). `tag_names` is an array of tag names.
///
/// # Errors
///
/// Fails if `tag_names` is not an array of strings.
#[wasm_bindgen(js_name = appendTagHashtags)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn append_tag_hashtags_js(
    body: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] tag_names: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let names: Vec<String> = serde_wasm_bindgen::from_value(tag_names)?;
    Ok(note_tags::append_tag_hashtags(body, &names))
}

/// [`remove_hashtag_from_body`](note_tags::remove_hashtag_from_body).
#[wasm_bindgen(js_name = removeHashtagFromBody)]
#[must_use]
pub fn remove_hashtag_from_body_js(body: &str, tag: &str) -> String {
    note_tags::remove_hashtag_from_body(body, tag)
}

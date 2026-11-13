//! wasm export for the link-form preview sentence (wf-core `relations::relation_phrase`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::relation_phrase::link_sentence;

/// [`link_sentence`]: "‹from› cites ‹to›", or `null` until both papers are picked.
#[wasm_bindgen(js_name = linkSentence, unchecked_return_type = "string | null")]
pub fn link_sentence_js(from: Option<String>, relation: &str, to: Option<String>) -> JsValue {
    link_sentence(from.as_deref(), relation, to.as_deref()).map_or(JsValue::NULL, JsValue::from)
}

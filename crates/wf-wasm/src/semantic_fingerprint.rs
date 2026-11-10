//! Semantic index fingerprints and passage ids for JavaScript (wf-core `semantic_fingerprint`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::semantic_fingerprint;

/// [`text_hash`](semantic_fingerprint::text_hash): the stored fingerprint of a document's embedded text.
#[wasm_bindgen(js_name = textHash)]
#[must_use]
pub fn text_hash_js(text: &str) -> String {
    semantic_fingerprint::text_hash(text)
}

/// [`document_id_of`](semantic_fingerprint::document_id_of): the document a passage id belongs to.
#[wasm_bindgen(js_name = documentIdOf)]
#[must_use]
pub fn document_id_of_js(passage: &str) -> String {
    semantic_fingerprint::document_id_of(passage)
}

/// [`embeddable_text`](semantic_fingerprint::embeddable_text): the text a document is embedded from.
#[wasm_bindgen(js_name = embeddableText)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Vec<String>.
pub fn embeddable_text_js(title: &str, aliases: Vec<String>, body: &str) -> String {
    semantic_fingerprint::embeddable_text(title, &aliases, body)
}

/// [`document_id_of_path`](semantic_fingerprint::document_id_of_path): the document id behind a workspace file name.
#[wasm_bindgen(js_name = documentIdOfPath)]
#[must_use]
pub fn document_id_of_path_js(file: &str) -> String {
    semantic_fingerprint::document_id_of_path(file)
}

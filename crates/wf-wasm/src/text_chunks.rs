//! Passage splitting for embeddings for JavaScript (wf-core `search::text_chunks`). The JS names
//! match `packages/core/src/search/text-chunks.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::text_chunks::{self, ChunkOptions};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`chunk_for_embedding`](text_chunks::chunk_for_embedding); `undefined` options take the defaults.
///
/// # Errors
///
/// Fails if `options` has the wrong shape.
#[wasm_bindgen(js_name = chunkForEmbedding)]
pub fn chunk_for_embedding_js(text: &str, options: JsValue) -> JsResult<JsValue> {
    let options: ChunkOptions = if options.is_undefined() {
        ChunkOptions::default()
    } else {
        serde_wasm_bindgen::from_value(options)?
    };
    to_js(&text_chunks::chunk_for_embedding(text, &options))
}

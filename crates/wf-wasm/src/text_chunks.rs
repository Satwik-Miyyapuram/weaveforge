//! Passage splitting for embeddings for JavaScript (wf-core `search::text_chunks`). The JS names
//! match `packages/core/src/search/text-chunks.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::text_chunks::{self, ChunkOptions};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`chunk_for_embedding`](text_chunks::chunk_for_embedding); missing options take the defaults.
///
/// # Errors
///
/// Fails if `options` has the wrong shape.
#[wasm_bindgen(js_name = chunkForEmbedding, unchecked_return_type = "B.TextChunk[]")]
pub fn chunk_for_embedding_js(
    text: &str,
    #[wasm_bindgen(unchecked_optional_param_type = "B.ChunkOptions")] options: Option<JsValue>,
) -> JsResult<JsValue> {
    let options: ChunkOptions = match options {
        Some(options) => serde_wasm_bindgen::from_value(options)?,
        None => ChunkOptions::default(),
    };
    to_js(&text_chunks::chunk_for_embedding(text, &options))
}

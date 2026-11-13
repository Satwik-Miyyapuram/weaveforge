//! Embedder lifecycle rules for JavaScript (wf-core `search::embedding_runtime`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::embedding_runtime;

/// [`IDLE_EVICT_MS`](embedding_runtime::IDLE_EVICT_MS): milliseconds an idle embedder keeps its model.
#[wasm_bindgen(js_name = embedIdleEvictMs)]
#[must_use]
pub fn embed_idle_evict_ms() -> u32 {
    embedding_runtime::IDLE_EVICT_MS
}

/// [`supports_local_embedding`](embedding_runtime::supports_local_embedding), from the browser's
/// `Worker` and `WebAssembly` presence.
#[wasm_bindgen(js_name = supportsLocalEmbedding)]
#[must_use]
pub fn supports_local_embedding_js(has_worker: bool, has_web_assembly: bool) -> bool {
    embedding_runtime::supports_local_embedding(has_worker, has_web_assembly)
}

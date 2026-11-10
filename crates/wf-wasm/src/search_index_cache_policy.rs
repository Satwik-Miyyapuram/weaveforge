//! Index persistence rule for JavaScript (wf-core `index_cache_policy`).
//! The JS name matches `packages/wf-wasm/src/index-cache-policy.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::index_cache_policy;

/// [`should_persist_index`](index_cache_policy::should_persist_index).
#[wasm_bindgen(js_name = shouldPersistIndex)]
#[must_use]
pub fn should_persist_index_js(installed_app: bool, document_count: u32) -> bool {
    index_cache_policy::should_persist_index(installed_app, document_count as usize)
}

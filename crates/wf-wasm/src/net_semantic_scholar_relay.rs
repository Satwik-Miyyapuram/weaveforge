//! Semantic Scholar relay target for JavaScript (wf-core `net::semantic_scholar_relay`).
//! The JS name matches `packages/wf-wasm/src/net-semantic-scholar-relay.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::semantic_scholar_relay;

/// [`semantic_scholar_target`](semantic_scholar_relay::semantic_scholar_target): the upstream
/// URL for a relay path, or `undefined` when the path is not one.
#[wasm_bindgen(js_name = semanticScholarTarget)]
#[must_use]
pub fn semantic_scholar_target_js(pathname: &str, search: &str) -> Option<String> {
    semantic_scholar_relay::semantic_scholar_target(pathname, search)
}

//! Semantic Scholar relay target for JavaScript (wf-core `net::semantic_scholar_relay`).
//! The JS name matches `packages/wf-wasm/src/wrappers-9.ts`.

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wf_core::net::semantic_scholar_relay;

/// [`semantic_scholar_target`](semantic_scholar_relay::semantic_scholar_target): the upstream
/// URL for a relay path, or `null` when the path is not one.
#[wasm_bindgen(js_name = semanticScholarTarget, unchecked_return_type = "string | null")]
#[must_use]
pub fn semantic_scholar_target_js(pathname: &str, search: &str) -> JsValue {
    let value = semantic_scholar_relay::semantic_scholar_target(pathname, search);
    value.map_or(JsValue::NULL, JsValue::from)
}

//! Semantic Scholar retry policy for JavaScript (wf-core `net::semantic_scholar_retry`). The JS
//! names match `apps/web/src/lib/semantic-scholar-fetch.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::semantic_scholar_retry;

/// [`should_retry`](semantic_scholar_retry::should_retry): `status` is `undefined` for a thrown network error.
#[wasm_bindgen(js_name = semanticScholarShouldRetry)]
#[must_use]
pub fn semantic_scholar_should_retry_js(status: Option<u16>, attempt: u32) -> bool {
    semantic_scholar_retry::should_retry(status, attempt)
}

/// [`retry_wait_ms`](semantic_scholar_retry::retry_wait_ms): the wait before the next attempt.
#[wasm_bindgen(js_name = semanticScholarRetryWaitMs)]
#[must_use]
pub fn semantic_scholar_retry_wait_ms_js(attempt: u32) -> u32 {
    semantic_scholar_retry::retry_wait_ms(attempt)
}

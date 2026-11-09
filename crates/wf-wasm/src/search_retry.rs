//! Fuzzy-retry rules for JavaScript (wf-core `search_retry`). The JS names match
//! `packages/core/src/search/search-retry.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::search_retry;

/// [`should_retry`](search_retry::should_retry).
#[wasm_bindgen(js_name = shouldRetrySearch)]
pub fn should_retry_js(result_count: u32, term_count: u32) -> bool {
    search_retry::should_retry(result_count as usize, term_count as usize)
}

/// [`retry_fuzziness_for_term`](search_retry::retry_fuzziness_for_term).
#[wasm_bindgen(js_name = retryFuzzinessForTerm)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn retry_fuzziness_for_term_js(term: String, retry: bool) -> f64 {
    search_retry::retry_fuzziness_for_term(&term, retry)
}

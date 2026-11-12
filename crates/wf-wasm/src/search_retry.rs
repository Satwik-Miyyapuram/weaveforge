//! Fuzzy-retry rules for JavaScript (wf-core `search_retry`). The JS names match
//! `packages/core/src/search/search-retry.ts`.

use js_sys::{Object, Reflect};
use wasm_bindgen::JsValue;
use wasm_bindgen::closure::Closure;
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

/// Whether, and how, to re-run a query that returned no results, as
/// `{ retry, fuzzinessFor(term) }`. The fuzziness for each term is absolute (max edit
/// distance), or 0 to leave it alone.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(
    js_name = planFuzzyRetry,
    unchecked_return_type = "{ retry: boolean; fuzzinessFor(term: string): number }"
)]
pub fn plan_fuzzy_retry_js(
    #[wasm_bindgen(unchecked_param_type = "{ resultCount: number; termCount: number }")]
    input: JsValue,
) -> Result<JsValue, JsValue> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Input {
        result_count: u32,
        term_count: u32,
    }
    let input: Input = serde_wasm_bindgen::from_value(input)?;
    let retry = should_retry_js(input.result_count, input.term_count);
    let fuzziness_for = Closure::<dyn Fn(String) -> f64>::new(move |term: String| {
        search_retry::retry_fuzziness_for_term(&term, retry)
    })
    .into_js_value();
    let out = Object::new();
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("retry"),
        &JsValue::from_bool(retry),
    )?;
    let _ = Reflect::set(&out, &JsValue::from_str("fuzzinessFor"), &fuzziness_for)?;
    Ok(out.into())
}
